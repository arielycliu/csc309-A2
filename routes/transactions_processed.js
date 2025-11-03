const { CLEARANCE, requireClearance, roleRank } = require('./auth_middleware');
const { validateString, validateEnum, validateDate, validateNumber, validateBoolean, validateInputFields } = require('./utils/validators');
const { PrismaClient, TransactionType } = require('@prisma/client');

const prisma = new PrismaClient();
const express = require("express");
const router = express.Router();

const validators = {
    transactionId(transactionId, required = true) {
        return validateNumber(transactionId, 'transactionId', { required })
    },

    processed(processed, required = true) {
        return validateBoolean(processed, 'processed', { required })
    },
}

// Set a redemption transaction as being completed
router.patch('/:transactionId/processed', requireClearance(CLEARANCE.CASHIER), async (req, res) => {
    let transactionId = req.params["transactionId"];
    const { processed } = req.body;
    let validations = [
        () => validators.transactionId(transactionId, true),
        () => validators.processed(processed, true),
    ]
    if (validateInputFields(validations, res)) return;
    if (processed !== 'true' && processed !== true) res.status(400).json({ 'error': 'Bad Request: processed field must be set to true' });
    transactionId = parseInt(transactionId);

    await prisma.$transaction(async (prisma) => {
        let transaction = await prisma.transaction.findUnique({
            where: { id: transactionId }
        })
        if (!transaction) {
            return res.status(404).json({ 'error': 'Transaction not found' });
        }
        if (transaction?.type !== "redemption") {
            return res.status(400).json({ 'error': 'Bad Request: transaction is not of type redemption' });
        }
        if (transaction?.processedById) {
            return res.status(400).json({ 'error': `Bad Request: transaction has already been processed` });
        }

        const cashierId = parseInt(req.auth.sub);
        transaction = await prisma.transaction.update({
            where: { id: transactionId },
            data: {
                processedById: cashierId
            }
        })

        const user = await prisma.user.update({
            where: { id: transaction.userId },
            data: {
                points: { increment: transaction.amount } // is negative
            }
        })

        const cashier = await prisma.user.findUnique({
            where: { id: cashierId }
        })

        const creator = await prisma.user.findUnique({
            where: { id: transaction.createdById }
        })

        const result = {
            id: transactionId,
            utorid: user.utorid,
            type: transaction.type,
            processedBy: cashier.utorid,
            redeemed: -1 * transaction.amount,
            remark: transaction.remark,
            createdBy: creator ? creator.utorid : null
        }
        return res.status(200).json(result);
    });
});

router.all('/', async (req, res) => {
    res.status(405).json({ 'error': 'Method Not Allowed' });
});

module.exports = router;