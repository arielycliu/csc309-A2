const { CLEARANCE, requireClearance, roleRank } = require('./temp_middleware');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');

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
};

function validateInputFields(validations, res) {
    for (let validationFunction of validations) {
        let error = validationFunction();
        if (error) {
            res.status(400).json({ 'error': error });
            return true;
        }
    }
    return false;
}


router.all('/', async (req, res) => {
    res.status(405).json({ 'error': 'Method Not Allowed' });
});

module.exports = router;