const { CLEARANCE, requireClearance, roleRank } = require('./temp_middleware');
const { PrismaClient, PromotionType} = require('@prisma/client');

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
    const prismaType = type === 'one-time' ? PromotionType.onetime : PromotionType.automatic;

    const newPromotion = await prisma.promotion.create({
        data: {
            name,
            description,
            type: prismaType,
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

    const now = new Date();
    let filters = {}
    if (isManagerOrHigher) {
        filters.id = parseInt(promotionId);
    } else if (isRegularOrHigher) {
        filters.startTime = { lte: now };
        filters.endTime = { gte: now };
        filters.id = parseInt(promotionId);
    }
    const promotion = await prisma.promotion.findUnique({
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

// update an existing promotion
router.patch('/:promotionId', requireClearance(CLEARANCE.MANAGER), async (req, res) => {
    const promotionId = req.params["promotionId"];
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
        () => validators.promotionId(promotionId, true),
    ], res)) return;

    const existingPromotion = await prisma.promotion.findUnique({
        where: { id: parseInt(promotionId) },
    });

    if (!existingPromotion) {
        return res.status(404).json({ 'error': 'Promotion not found' });
    }

    const now = new Date();
    const originalStartTime = new Date(existingPromotion.startTime);
    const originalEndTime = new Date(existingPromotion.endTime);
    const hasStarted = originalStartTime < now;
    const hasEnded = originalEndTime < now;

    const fieldsToUpdate = {};

    const validations = [];

    if (name !== undefined) {
        validations.push(() => validators.name(name, true));
        if (hasStarted) {
            return res.status(400).json({ 'error': 'Bad Request: cannot update name after the original start time has passed' });
        }
        fieldsToUpdate.name = name;
    }

    if (description !== undefined) {
        validations.push(() => validators.description(description, true));
        if (hasStarted) {
            return res.status(400).json({ 'error': 'Bad Request: cannot update description after the original start time has passed' });
        }
        fieldsToUpdate.description = description;
    }

    if (type !== undefined) {
        validations.push(() => validators.type(type, true));
        if (hasStarted) {
            return res.status(400).json({ 'error': 'Bad Request: cannot update type after the original start time has passed' });
        }
        const prismaType = type === 'one-time' ? PromotionType.onetime : PromotionType.automatic;
        fieldsToUpdate.type = prismaType;
    }

    if (startTime !== undefined) {
        validations.push(() => validators.startTime(startTime, true));
        const startTimeDate = new Date(startTime);
        if (startTimeDate < now) {
            return res.status(400).json({ 'error': 'Bad Request: start time must not be in the past' });
        }
        if (hasStarted) {
            return res.status(400).json({ 'error': 'Bad Request: cannot update startTime after the original start time has passed' });
        }
        fieldsToUpdate.startTime = startTimeDate;
    }

    if (endTime !== undefined) {
        const effectiveStartTime = startTime !== undefined ? startTime : existingPromotion.startTime;
        validations.push(() => validators.endTime(endTime, effectiveStartTime, true));
        const endTimeDate = new Date(endTime);
        if (endTimeDate < now) {
            return res.status(400).json({ 'error': 'Bad Request: end time must not be in the past' });
        }
        if (hasEnded) {
            return res.status(400).json({ 'error': 'Bad Request: cannot update endTime after the original end time has passed' });
        }
        fieldsToUpdate.endTime = endTimeDate;
    }

    if (minSpending !== undefined) {
        validations.push(() => validators.minSpending(minSpending, true));
        if (hasStarted) {
            return res.status(400).json({ 'error': 'Bad Request: cannot update minSpending after the original start time has passed' });
        }
        fieldsToUpdate.minSpending = minSpending;
    }

    if (rate !== undefined) {
        validations.push(() => validators.rate(rate, true));
        if (hasStarted) {
            return res.status(400).json({ 'error': 'Bad Request: cannot update rate after the original start time has passed' });
        }
        fieldsToUpdate.rate = rate;
    }

    if (points !== undefined) {
        validations.push(() => validators.points(points, false));
        if (hasStarted) {
            return res.status(400).json({ 'error': 'Bad Request: cannot update points after the original start time has passed' });
        }
        fieldsToUpdate.points = points;
    }

    if (validateInputFields(validations, res)) return;

    // no fields to update
    if (Object.keys(fieldsToUpdate).length === 0) {
        // might need to convert promotion type from prisma schema to api type
        // const apiType = existingPromotion.type === PromotionType.onetime ? 'one-time' : 'automatic';
        return res.status(200).json({
            id: existingPromotion.id,
            name: existingPromotion.name,
            type: existingPromotion.type,
        });
    }

    const updatedPromotion = await prisma.promotion.update({
        where: { id: parseInt(promotionId) },
        data: fieldsToUpdate,
    });

    // same thing with type here and in patch: change from prisma to api? one-time vs onetime
    const response = {
        id: updatedPromotion.id,
        name: updatedPromotion.name,
        type: updatedPromotion.type,
    };

    if (description !== undefined) response.description = updatedPromotion.description;
    if (startTime !== undefined) response.startTime = updatedPromotion.startTime;
    if (endTime !== undefined) response.endTime = updatedPromotion.endTime;
    if (minSpending !== undefined) response.minSpending = updatedPromotion.minSpending;
    if (rate !== undefined) response.rate = updatedPromotion.rate;
    if (points !== undefined) response.points = updatedPromotion.points;

    res.status(200).json(response);
});

// update an existing promotion
router.delete('/:promotionId', requireClearance(CLEARANCE.MANAGER), async (req, res) => {
    const promotionId = req.params["promotionId"];

    if (validateInputFields([
        () => validators.promotionId(promotionId, true),
    ], res)) return;

    const existingPromotion = await prisma.promotion.findUnique({
        where: { id: parseInt(promotionId) },
    });

    if (!existingPromotion) {
        return res.status(404).json({ 'error': 'Promotion not found' });
    } 
    
    const now = new Date();
    const originalStartTime = new Date(existingPromotion.startTime);
    const hasStarted = originalStartTime < now;
    if (hasStarted) {
        return res.status(403).json({ 'error': 'Forbidden to edit ongoing promotion' });
    }

    await prisma.promotion.delete({
        where: { id: parseInt(promotionId) }
    })

    res.status(204).send('No Content');
});

router.all('/', async (req, res) => {
    res.status(405).json({ 'error': 'Method Not Allowed' });
});

module.exports = router;