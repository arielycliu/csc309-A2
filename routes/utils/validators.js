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
        requireInteger = false, // required it to be an integer
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
        if (isNaN(value)) {
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

module.exports = { validateString, validateEnum, validateDate, validateNumber, validateBoolean };