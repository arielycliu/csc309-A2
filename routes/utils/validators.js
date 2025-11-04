function validateString(value, fieldName, options = {}) {
    const { required = true } = options;

    if (required && value === undefined) {
        return `missing field: ${fieldName}`;
    } else if (!required && value === undefined) {
        return null;
    }

    if (typeof value !== 'string') {
        return `${fieldName} should be a string; ${value}`;
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
        return `${fieldName} must be either ${allowedValues.map(v => `'${v}'`).join(' or ')}; ${value}`;
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
        return `${fieldName} must be a valid date; ${value}`;
    }

    if (mustNotBePast) {
        const now = new Date();
        if (date < now) {
            return `${fieldName} must not be in the past; ${value}`;
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
    } else if (!required && (value === undefined || value === null)) {
        return null;
    }

    if (requireInteger) {
        if (!Number.isInteger(value)) {
            return `${fieldName} must be a valid integer; ${value}`;
        }
    } else {
        if (Number.isNaN(value)) {
            return `${fieldName} must be a valid number; ${value}`;
        }
    }

    if (minValue !== null) {
        const isValid = minInclusive ? value >= minValue : value > minValue;
        if (!isValid) {
            const comparison = minInclusive ? 'greater than or equal to' : 'greater than';
            const typeLabel = requireInteger ? 'integer' : 'number';
            return `${fieldName} must be a valid ${typeLabel}, ${comparison} ${minValue}; ${value}`;
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

    if (typeof value === 'string') {
        if (value === 'true' || value === 'True') value = true;
        else if (value === 'false' || value === 'False') value = false;
        else return `${fieldName} should be a boolean; ${value}`;
    }

    if (typeof value !== 'boolean') {
        return `${fieldName} should be a boolean; ${value}`;
    }

    return null;
}

function validateInputFields(validations, res) {
    for (let validationFunction of validations) {
        let error = validationFunction();
        if (error) {
            // console.log({ 'error': `Bad Request: ${error}.` });
            res.status(400).json({ 'error': `Bad Request: ${error}` });
            return true;
        }
    }
    return false;
}

module.exports = { validateString, validateEnum, validateDate, validateNumber, validateBoolean, validateInputFields };