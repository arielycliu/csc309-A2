const { CLEARANCE, requireClearance, roleRank } = require('./temp_middleware');
const { PrismaClient} = require('@prisma/client');

const prisma = new PrismaClient();
const express = require("express");
const router = express.Router();

function validateString(value, fieldName, options = {}) {
    const { required = true } = options;

    if (required && value === undefined) {
        return `missing field: ${fieldName}`;
    } else if (!required && value === undefined) {
        return null;
    }

    if (typeof value !== 'string') {
        return `${fieldName} should be a string`;
    }

    return null;
}

function validateEnum(value, fieldName, allowedValues, options = {}) {
    const { required = true } = options;

    if (required && value === undefined) {
        return `missing field: ${fieldName}`;
    } else if (!required && value === undefined) {
        return null;
    }

    if (!allowedValues.includes(value)) {
        return `${fieldName} must be either ${allowedValues.map(v => `'${v}'`).join(' or ')}`;
    }

    return null;
}

function validateDate(value, fieldName, options = {}) {
    const {
        required = true,
        mustNotBePast = false,
        mustBeAfter = null,
        mustBeAfterFieldName = null // human readable for error message
    } = options;

    if (required && value === undefined) {
        return `missing field: ${fieldName}`;
    } else if (!required && value === undefined) {
        return null;
    }

    const date = new Date(value);
    if (isNaN(date.getTime())) {
        return `${fieldName} must be a valid date`;
    }

    if (mustNotBePast) {
        const now = new Date();
        if (date < now) {
            return `${fieldName} must not be in the past`;
        }
    }

    if (mustBeAfter !== null) {
        const compareDate = new Date(mustBeAfter);
        if (date <= compareDate) {
            const afterField = mustBeAfterFieldName || mustBeAfter;
            return `${fieldName} must be after ${afterField}`;
        }
    }

    return null;
}

function validateNumber(value, fieldName, options = {}) {
    const {
        required = false,
        requireInteger = false, 
        minValue = null,  // null means there is no minimum check
        minInclusive = true  // true means >=, false means >
    } = options;

    if (required && value === undefined) {
        return `missing field: ${fieldName}`;
    } else if (!required && value === undefined) {
        return null;
    }

    if (requireInteger) {
        if (!Number.isInteger(value)) {
            return `${fieldName} must be a valid integer`;
        }
    } else {
        if (typeof value !== 'number') {
            return `${fieldName} must be a valid number`;
        }
    }

    if (minValue !== null) {
        const isValid = minInclusive ? value >= minValue : value > minValue;
        if (!isValid) {
            const comparison = minInclusive ? 'greater than or equal to' : 'greater than';
            const typeLabel = requireInteger ? 'integer' : 'number';
            return `${fieldName} must be a valid ${typeLabel}, ${comparison} ${minValue}`;
        }
    }

    return null;
}

function validateBoolean(value, fieldName, options = {}) {
    const { required = false } = options;

    if (required && value === undefined) {
        return `missing field: ${fieldName}`;
    } else if (!required && value === undefined) {
        return null;
    }

    if (typeof value !== 'boolean') {
        return `${fieldName} should be a boolean`;
    }

    return null;
}

const validators = {
    name(name, required = true) {
        return validateString(name, 'name', { required });
    },

    description(description, required = true) {
        return validateString(description, 'description', { required });
    },

    type(type, required = true) {
        return validateEnum(type, 'type', ['automatic', 'one-time'], { required });
    },

    startTime(startTime, required = true) {
        return validateDate(startTime, 'startTime', { required, mustNotBePast: true });
    },

    endTime(endTime, startTime, required = true) {
        return validateDate(endTime, 'endTime', { 
            required, 
            mustBeAfter: startTime,
            mustBeAfterFieldName: 'startTime'
        });
    },

    minSpending(minSpending, required = false) {
        return validateNumber(minSpending, 'minSpending', { required, minValue: 0, minInclusive: false });
    },

    rate(rate, required = false) {
        return validateNumber(rate, 'rate', { required, minValue: 0, minInclusive: true });
    },

    points(points, required = false) {
        return validateNumber(points, 'points', { required, requireInteger: true, minValue: 0, minInclusive: true });
    },

    page(page, required = false) {
        return validateNumber(page, 'page', { required, minValue: 0, minInclusive: true });
    },

    limit(limit, required = false) {
        return validateNumber(limit, 'limit', { required, minValue: 0, minInclusive: true });
    },

    started(started, required = false) {
        return validateBoolean(started, 'started', { required });
    },

    ended(ended, required = false) {
        return validateBoolean(ended, 'ended', { required });
    },

    promotionId(promotionId, required = true) {
        return validateNumber(promotionId, 'promotionId', { required });
    },
};

function validateInputFields(validations, res) {
    for (let validationFunction of validations) {
        let error = validationFunction();
        if (error) {
            res.status(400).json({ 'error': `Bad Request: ${error}` });
            return true;
        }
    }
    return false;
}

// create a new promotion
router.post('/', requireClearance(CLEARANCE.MANAGER), async (req, res) => {
    const {
        name,
        description,
        type,
        startTime,
        endTime,
        minSpending,
        rate,
        points,
    } = req.body;

    if (validateInputFields([
        () => validators.name(name),
        () => validators.description(description),
        () => validators.type(type),
        () => validators.startTime(startTime),
        () => validators.endTime(endTime, startTime),
        () => validators.minSpending(minSpending),
        () => validators.rate(rate),
        () => validators.points(points),
    ], res)) return;
    
    const startTimeDate = new Date(startTime);
    const endTimeDate = new Date(endTime);

    const newPromotion = await prisma.promotion.create({
        data: {
            name,
            description,
            type,
            startTime: startTimeDate,
            endTime: endTimeDate,
            minSpending: minSpending ?? null,
            rate: rate ?? null,
            points: points ?? null,
        },
    });

    res.status(201).json(newPromotion);
});

// retrieve a list of promotions: different features depending on role (manager vs regular)
router.get('/', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
    const rank = roleRank(req.auth?.role);
    const isManagerOrHigher = rank >= 3;
    const isRegular = req.auth?.role === 'regular';
    const { name, type, page, limit, started, ended } = req.query;

    const validations = [
        () => validators.name(name, false),
        () => validators.type(type, false),
        () => validators.page(page, false),
        () => validators.limit(limit, false),
    ];

    if (isManagerOrHigher) {
        validations.push(
            () => validators.started(started, false),
            () => validators.ended(ended, false)
        );
    }

    if (validateInputFields(validations, res)) return;

    const pageNumber = parseInt(page) || 1;
    const limitNumber = parseInt(limit) || 10;
    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const now = new Date();
    let filters = {};

    if (name) {
        filters.name = { contains: name, mode: 'insensitive' };
    }
    if (type && ['automatic', 'one-time'].includes(type)) {
        filters.type = { type };
    }

    if (isManagerOrHigher) {
        if (started && ended) {
            res.status(405).json({ 'error': 'Bad request: both "started" and "ended" fields are specified' });
        }
        if (started) {
            filters.startTime = { lte: now };
        }
        if (ended) {
            filters.endTime = { lte: now };
        }
    }
    if (isRegular) {
        console.log("regular user");
        const userId = req.auth?.sub;

        // regular user: show only active promotions
        filters.startTime = { lte: now };
        filters.endTime = { gte: now };

        // removed used promotions
        const usedPromotionIds = await prisma.transactionPromotion.findMany({
            where: { transaction: { userId } },
            select: { promotionId: true }
        });
        if (usedPromotionIds.length > 0) {
            filters.id = { notIn: usedPromotionIds.map(p => p.promotionId) };
        }
    }

    const count = await prisma.promotion.count({ where: filters });
    const results = await prisma.promotion.findMany({
        where: filters,
        skip,
        take,
        orderBy: { startTime: 'asc' },
        select: {
            id: true,
            name: true,
            type: true,
            startTime: isManagerOrHigher,
            endTime: true,
            minSpending: true,
            rate: true,
            points: true,
        },
    });
    
    res.status(200).json({ count, results });
});

// retrieve a single event: different features depending on role (manager vs regular)
router.get('/:promotionId', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
    const promotionId = req.params["promotionId"];
    const rank = roleRank(req.auth?.role);
    const isManagerOrHigher = rank >= 3;
    const isRegularOrHigher = rank >= 1;

    const validations = [
        () => validators.promotionId(promotionId, true),
    ];
    if (validateInputFields(validations, res)) return;

    let filters = {}
    if (isManagerOrHigher) {
        filters.id = promotionId;
    } else if (isRegularOrHigher) {
        filters.startTime = { lte: now };
        filters.endTime = { gte: now };
        filters.id = promotionId;
    }
    const promotion = await prisma.promotion.findFirst({
        where: filters,
        select: {
            id: true,
            name: true,
            description: true,
            type: true,
            startTime: isManagerOrHigher,
            endTime: true,
            minSpending: true,
            rate: true,
            points: true,
        },
    })
    if (!promotion) {
        return res.status(404).json({ 'error': 'Promotion not found' })
    }
    res.status(200).json(promotion);
});

router.all('/', async (req, res) => {
    res.status(405).json({ 'error': 'Method Not Allowed' });
});

module.exports = router;