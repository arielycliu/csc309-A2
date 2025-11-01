const { CLEARANCE, requireClearance, roleRank } = require('./auth_middleware');
const { validateString, validateEnum, validateDate, validateNumber, validateBoolean } = require('./utils/validators');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const express = require("express");
const router = express.Router();

const validators = {
    type(type, required = true) {
        return validateEnum(type, 'type', ['redemption'], { required });
    },

    amount(amount, required = true) {
        return validateNumber(amount, 'amount', { required, requireInteger: true, minValue: 0, minInclusive: true })
    },

    remark(remark, required = false) {
        return validateString(remark, 'remark', { required })
    },

    relatedId(relatedId, type, required = false) { // must be used with type
        if (relatedId !== undefined && validateEnum(type, 'type', { required: true })) {
            return 'relatedId must be used with type. ' + validateEnum(type, 'type', ['redemption'], { required: true })
        }
        return validateNumber(relatedId, 'relatedId', { required })
    },

    promotionId(promotionId, required = false) {
        return validateNumber(promotionId, 'promotionId', { required })
    },

    amount(amount, required = false) { // must be used with operator
        if (amount !== undefined && validateEnum(operator, 'operator', ['gte', 'lte'], { required: true }))
        return validateNumber(amount, 'amount', { required })
    },

    page(page, required = false) {
        return validateNumber(page, 'page', { required });
    },

    limit(limit, required = false) {
        return validateNumber(limit, 'limit', { required });
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

router.all('/', async (req, res) => {
    res.status(405).json({ 'error': 'Method Not Allowed' });
});

module.exports = router;