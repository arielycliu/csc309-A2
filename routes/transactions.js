const express = require("express");
const {
	PrismaClient,
	TransactionType,
	PromotionType,
} = require("@prisma/client");

const router = express.Router();
const prisma = new PrismaClient();

const roleRank = {
	regular: 1,
	cashier: 2,
	manager: 3,
	superuser: 4,
};

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

const sendError = (res, status, message) => {
	res.status(status).json({ error: message });
};

const getAuthPayload = (req) => req.user || req.auth || null;

const normalizeUtorid = (utorid) =>
	typeof utorid === "string" ? utorid.trim().toLowerCase() : "";

const requireAuth = async (req, res, next) => {
	try {
		const payload = getAuthPayload(req);
		if (!payload) {
			throw new HttpError(401, "Unauthorized");
		}

		const subject = payload.sub ?? payload.id;
		const userId =
			typeof subject === "number"
				? subject
				: parseInt(subject, 10);

		if (!Number.isInteger(userId)) {
			throw new HttpError(401, "Unauthorized");
		}

		const actor = await prisma.user.findUnique({ where: { id: userId } });

		if (!actor) {
			throw new HttpError(401, "Unauthorized");
		}

		req.actor = actor;
		return next();
	} catch (err) {
		if (err instanceof HttpError) {
			return sendError(res, err.status, err.message);
		}

		console.error("requireAuth error", err);
		return sendError(res, 500, "Internal server error");
	}
};

const hasMinRole = (actor, minimumRole) =>
	roleRank[actor.role] >= roleRank[minimumRole];

const normalizePromotionIds = (promotionIds) => {
	if (promotionIds === null) {
		return [];
	}

	if (!Array.isArray(promotionIds)) {
		throw new HttpError(400, "promotionIds must be an array");
	}

	const unique = [];
	for (const raw of promotionIds) {
		const id =
			typeof raw === "number"
				? raw
				: typeof raw === "string"
				? parseInt(raw, 10)
				: NaN;

		if (!Number.isInteger(id) || id <= 0) {
			throw new HttpError(400, "promotionIds must contain positive integers");
		}

		if (!unique.includes(id)) {
			unique.push(id);
		}
	}

	return unique;
};

const computeBaseEarned = (spentCents) => Math.round(spentCents / 25);

const computeRateBonus = (spentCents, rate) =>
	Math.round(spentCents * rate);

const loadAndValidatePromotions = async (
	tx,
	promotionIds,
	userId,
	options = {}
) => {
	const spentCents =
		typeof options.spentCents === "number" ? options.spentCents : null;

	if (!promotionIds.length) {
		return { promotions: [], extraPoints: 0 };
	}

	const promotions = await tx.promotion.findMany({
		where: { id: { in: promotionIds } },
	});

	if (promotions.length !== promotionIds.length) {
		throw new HttpError(400, "One or more promotions are invalid");
	}

	const now = new Date();
	let extraPoints = 0;

	for (const promo of promotions) {
		if (promo.startTime > now || promo.endTime < now) {
			throw new HttpError(400, "Promotion is not active");
		}

		if (promo.minSpending != null) {
			if (spentCents === null) {
				throw new HttpError(400, "Promotion requires a purchase amount");
			}

			if (spentCents / 100 < promo.minSpending) {
				throw new HttpError(400, "Promotion minimum spending not met");
			}
		}

		if (promo.type === PromotionType.onetime) {
			const used = await tx.transactionPromotion.findFirst({
				where: {
					promotionId: promo.id,
					transaction: {
						userId,
					},
				},
			});

			if (used) {
				throw new HttpError(400, "Promotion already used by this user");
			}
		}

		if (promo.rate != null && spentCents !== null) {
			extraPoints += computeRateBonus(spentCents, promo.rate);
		}

		if (promo.points != null) {
			extraPoints += promo.points;
		}
	}

	return { promotions, extraPoints };
};

const transactionInclude = {
	user: { select: { id: true, utorid: true, name: true } },
	createdBy: { select: { id: true, utorid: true, name: true } },
	processedBy: { select: { id: true, utorid: true, name: true } },
	event: { select: { id: true, name: true } },
	promotions: { select: { promotionId: true } },
};

const formatTransaction = (transaction) => {
	const promotionIds = transaction.promotions
		? transaction.promotions.map((tp) => tp.promotionId).sort((a, b) => a - b)
		: [];

	const base = {
		id: transaction.id,
		utorid: transaction.user ? transaction.user.utorid : null,
		type: transaction.type,
		amount: transaction.amount ?? null,
		spent: transaction.spent ?? null,
		promotionIds,
		suspicious: transaction.suspicious,
		remark: transaction.remark ?? "",
		createdBy: transaction.createdBy ? transaction.createdBy.utorid : null,
	};

	if (transaction.type === TransactionType.purchase) {
		base.earned = transaction.amount ?? 0;
	}

	if (transaction.type === TransactionType.redemption) {
		base.redeemed = Math.abs(transaction.amount ?? 0);
		base.processedBy = transaction.processedBy
			? transaction.processedBy.utorid
			: null;
		base.relatedId = transaction.processedById ?? null;
	}

	if (transaction.type === TransactionType.adjustment) {
		base.relatedId = transaction.relatedTransactionId ?? null;
	}

	if (transaction.type === TransactionType.transfer) {
		base.relatedId = transaction.relatedUserId ?? null;
		if (transaction.amount != null) {
			if (transaction.amount < 0) {
				base.sent = Math.abs(transaction.amount);
			} else {
				base.received = transaction.amount;
			}
		}
	}

	if (transaction.type === TransactionType.event) {
		base.relatedId = transaction.eventId ?? null;
		base.awarded = transaction.amount ?? 0;
	}

	return base;
};

const buildTransactionFilters = (query) => {
	const filters = [];

	const { name, createdBy, suspicious, promotionId, type, relatedId, amount, operator } =
		query;

	if (name) {
		filters.push({
			OR: [
				{ user: { utorid: { contains: name, mode: "insensitive" } } },
				{ user: { name: { contains: name, mode: "insensitive" } } },
			],
		});
	}

	if (createdBy) {
		filters.push({
			OR: [
				{
					createdBy: {
						utorid: { contains: createdBy, mode: "insensitive" },
					},
				},
				{
					createdBy: {
						name: { contains: createdBy, mode: "insensitive" },
					},
				},
			],
		});
	}

	if (suspicious !== undefined) {
		if (suspicious !== "true" && suspicious !== "false") {
			throw new HttpError(400, "Invalid suspicious filter");
		}

		filters.push({ suspicious: suspicious === "true" });
	}

	if (promotionId !== undefined) {
		const promoId = parseInt(promotionId, 10);
		if (!Number.isInteger(promoId) || promoId <= 0) {
			throw new HttpError(400, "Invalid promotionId filter");
		}

		filters.push({ promotions: { some: { promotionId: promoId } } });
	}

	if (type !== undefined) {
		if (!Object.values(TransactionType).includes(type)) {
			throw new HttpError(400, "Invalid transaction type filter");
		}

		filters.push({ type });
	}

	if (relatedId !== undefined) {
		const relId = parseInt(relatedId, 10);
		if (!Number.isInteger(relId) || relId <= 0) {
			throw new HttpError(400, "Invalid relatedId filter");
		}

		if (!type) {
			throw new HttpError(
				400,
				"relatedId filter must be used together with type"
			);
		}

		switch (type) {
			case TransactionType.adjustment:
				filters.push({ relatedTransactionId: relId });
				break;
			case TransactionType.transfer:
				filters.push({ relatedUserId: relId });
				break;
			case TransactionType.redemption:
				filters.push({ processedById: relId });
				break;
			case TransactionType.event:
				filters.push({ eventId: relId });
				break;
			default:
				filters.push({ relatedTransactionId: relId });
		}
	}

	if (amount !== undefined) {
		const amountValue = Number(amount);
		if (!Number.isFinite(amountValue)) {
			throw new HttpError(400, "Invalid amount filter");
		}

		if (!operator || !["gte", "lte"].includes(operator)) {
			throw new HttpError(400, "Invalid operator for amount filter");
		}

		filters.push({ amount: { [operator]: amountValue } });
	}

	if (!filters.length) {
		return {};
	}

	return { AND: filters };
};

const handlePurchaseCreation = async (req, res) => {
	try {
		const { utorid, spent, promotionIds, remark } = req.body || {};

		if (!utorid || typeof utorid !== "string") {
			return sendError(res, 400, "utorid is required");
		}

		const spentValue =
			typeof spent === "number"
				? spent
				: typeof spent === "string"
				? Number(spent)
				: NaN;

		if (!Number.isFinite(spentValue) || spentValue <= 0) {
			return sendError(res, 400, "spent must be a positive number");
		}

		const spentCents = Math.round(spentValue * 100);
		const normalizedSpent = spentCents / 100;

		const promotionIdList = normalizePromotionIds(promotionIds);

		const actor = req.actor;
		const isSuspicious = actor.role === "cashier" && actor.suspicious === true;

		const result = await prisma.$transaction(async (tx) => {
			const target = await tx.user.findUnique({
				where: { utorid: normalizeUtorid(utorid) },
			});

			if (!target) {
				throw new HttpError(404, "User not found");
			}

			const { promotions, extraPoints } = await loadAndValidatePromotions(
				tx,
				promotionIdList,
				target.id,
				{ spentCents }
			);

			const baseEarned = computeBaseEarned(spentCents);
			const earned = baseEarned + extraPoints;

			const created = await tx.transaction.create({
				data: {
					type: TransactionType.purchase,
					spent: normalizedSpent,
					amount: earned,
					remark: typeof remark === "string" ? remark : null,
					suspicious: isSuspicious,
					userId: target.id,
					createdById: actor.id,
					promotions: {
						create: promotions.map((promo) => ({
							promotion: { connect: { id: promo.id } },
						})),
					},
				},
				include: { promotions: { select: { promotionId: true } } },
			});

			if (!isSuspicious && earned > 0) {
				await tx.user.update({
					where: { id: target.id },
					data: { points: { increment: earned } },
				});
			}

			return { created, target };
		});

		const promotionIdResponse = result.created.promotions.map(
			(p) => p.promotionId
		);

		return res.status(201).json({
			id: result.created.id,
			utorid: result.target.utorid,
			type: TransactionType.purchase,
			spent: result.created.spent,
			earned: result.created.suspicious ? 0 : (result.created.amount ?? 0),
			remark: result.created.remark ?? "",
			promotionIds: promotionIdResponse,
			createdBy: req.actor.utorid,
		});
	} catch (err) {
		if (err instanceof HttpError) {
			return sendError(res, err.status, err.message);
		}

		console.error("POST /transactions purchase error", err);
		return sendError(res, 500, "Internal server error");
	}
};

const handleAdjustmentCreation = async (req, res) => {
	try {
		const { utorid, amount, relatedId, promotionIds, remark } = req.body || {};

		// utorid can be null/undefined for adjustments - we'll use the related transaction's user
		if (utorid !== null && utorid !== undefined) {
			if (typeof utorid !== "string") {
				return sendError(res, 400, "utorid must be a string");
			}
		}

		const amountValue =
			typeof amount === "number"
				? amount
				: typeof amount === "string"
				? Number(amount)
				: NaN;

		if (!Number.isInteger(amountValue)) {
			return sendError(res, 400, "amount must be an integer");
		}

		const relatedTxId =
			typeof relatedId === "number"
				? relatedId
				: typeof relatedId === "string"
				? parseInt(relatedId, 10)
				: NaN;

		if (!Number.isInteger(relatedTxId) || relatedTxId <= 0) {
			return sendError(res, 400, "relatedId must be a positive integer");
		}

		const promotionIdList = normalizePromotionIds(promotionIds);

		const result = await prisma.$transaction(async (tx) => {
			const relatedTx = await tx.transaction.findUnique({
				where: { id: relatedTxId },
			});

			if (!relatedTx) {
				throw new HttpError(404, "Related transaction not found");
			}

			// If utorid is provided, verify it matches the related transaction's user
			// Otherwise, use the related transaction's user
			let target;
			if (utorid) {
				target = await tx.user.findUnique({
					where: { utorid: normalizeUtorid(utorid) },
				});

				if (!target) {
					throw new HttpError(404, "User not found");
				}

				if (relatedTx.userId !== target.id) {
					throw new HttpError(400, "relatedId does not match the user");
				}
			} else {
				// Use the user from the related transaction
				target = await tx.user.findUnique({
					where: { id: relatedTx.userId },
				});

				if (!target) {
					throw new HttpError(404, "User not found");
				}
			}

			const { promotions, extraPoints } = await loadAndValidatePromotions(
				tx,
				promotionIdList,
				target.id,
				{ spentCents: null }
			);

			const totalAdjustment = amountValue + extraPoints;

			const created = await tx.transaction.create({
				data: {
					type: TransactionType.adjustment,
					amount: totalAdjustment,
					remark: typeof remark === "string" ? remark : null,
					userId: target.id,
					createdById: req.actor.id,
					relatedTransactionId: relatedTxId,
					promotions: {
						create: promotions.map((promo) => ({
							promotion: { connect: { id: promo.id } },
						})),
					},
				},
				include: { promotions: { select: { promotionId: true } } },
			});

			if (totalAdjustment !== 0) {
				await tx.user.update({
					where: { id: target.id },
					data: { points: { increment: totalAdjustment } },
				});
			}

			return { created, target };
		});

		const promotionIdResponse = result.created.promotions.map(
			(p) => p.promotionId
		);

		return res.status(201).json({
			id: result.created.id,
			utorid: result.target.utorid,
			amount: result.created.amount ?? 0,
			type: TransactionType.adjustment,
			relatedId: result.created.relatedTransactionId,
			remark: result.created.remark ?? "",
			promotionIds: promotionIdResponse,
			createdBy: req.actor.utorid,
		});
	} catch (err) {
		if (err instanceof HttpError) {
			return sendError(res, err.status, err.message);
		}

		console.error("POST /transactions adjustment error", err);
		return sendError(res, 500, "Internal server error");
	}
};

router.post("/", requireAuth, async (req, res) => {
	const { type } = req.body || {};

	if (type === TransactionType.purchase) {
		if (!hasMinRole(req.actor, "cashier")) {
			return sendError(res, 403, "Forbidden");
		}

		return handlePurchaseCreation(req, res);
	}

	if (type === TransactionType.adjustment) {
		if (!hasMinRole(req.actor, "manager")) {
			return sendError(res, 403, "Forbidden");
		}

		return handleAdjustmentCreation(req, res);
	}

	return sendError(res, 400, "Unsupported transaction type");
});

router.get(
	"/",
	requireAuth,
	async (req, res) => {
		try {
			if (!hasMinRole(req.actor, "manager")) {
				return sendError(res, 403, "Forbidden");
			}

			const pageValue =
				typeof req.query.page === "string"
					? parseInt(req.query.page, 10)
					: 1;
			const limitValue =
				typeof req.query.limit === "string"
					? parseInt(req.query.limit, 10)
					: 10;

			const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : NaN;
			const limit =
				Number.isInteger(limitValue) && limitValue > 0 ? limitValue : NaN;

			if (!Number.isInteger(page) || !Number.isInteger(limit)) {
				return sendError(res, 400, "page and limit must be positive integers");
			}

			const where = buildTransactionFilters(req.query);

			const [count, transactions] = await Promise.all([
				prisma.transaction.count({ where }),
				prisma.transaction.findMany({
					where,
					orderBy: { createdAt: "desc" },
					skip: (page - 1) * limit,
					take: limit,
					include: transactionInclude,
				}),
			]);

			const results = transactions.map(formatTransaction);

			return res.json({ count, results });
		} catch (err) {
			if (err instanceof HttpError) {
				return sendError(res, err.status, err.message);
			}

			console.error("GET /transactions error", err);
			return sendError(res, 500, "Internal server error");
		}
	}
);

router.get("/:transactionId", requireAuth, async (req, res) => {
	try {
		if (!hasMinRole(req.actor, "manager")) {
			return sendError(res, 403, "Forbidden");
		}

		const transactionId = parseInt(req.params.transactionId, 10);

		if (!Number.isInteger(transactionId) || transactionId <= 0) {
			return sendError(res, 400, "Invalid transaction id");
		}

		const transaction = await prisma.transaction.findUnique({
			where: { id: transactionId },
			include: transactionInclude,
		});

		if (!transaction) {
			return sendError(res, 404, "Transaction not found");
		}

		return res.json(formatTransaction(transaction));
	} catch (err) {
		console.error("GET /transactions/:transactionId error", err);
		return sendError(res, 500, "Internal server error");
	}
});

router.patch(
	"/:transactionId/suspicious",
	requireAuth,
	async (req, res) => {
		try {
			if (!hasMinRole(req.actor, "manager")) {
				return sendError(res, 403, "Forbidden");
			}

			const transactionId = parseInt(req.params.transactionId, 10);

			if (!Number.isInteger(transactionId) || transactionId <= 0) {
				return sendError(res, 400, "Invalid transaction id");
			}

			const { suspicious } = req.body || {};

			if (typeof suspicious !== "boolean") {
				return sendError(res, 400, "suspicious must be a boolean");
			}

			const updated = await prisma.$transaction(async (tx) => {
				const existing = await tx.transaction.findUnique({
					where: { id: transactionId },
					include: transactionInclude,
				});

				if (!existing) {
					throw new HttpError(404, "Transaction not found");
				}

				if (existing.suspicious !== suspicious) {
					if (
						existing.userId &&
						typeof existing.amount === "number" &&
						existing.amount > 0
					) {
						const delta = suspicious
							? -existing.amount
							: existing.amount;

						if (delta !== 0) {
							await tx.user.update({
								where: { id: existing.userId },
								data: { points: { increment: delta } },
							});
						}
					}
				}

				if (existing.suspicious === suspicious) {
					return existing;
				}

				return tx.transaction.update({
					where: { id: transactionId },
					data: { suspicious },
					include: transactionInclude,
				});
			});

			return res.json(formatTransaction(updated));
		} catch (err) {
			if (err instanceof HttpError) {
				return sendError(res, err.status, err.message);
			}

			console.error(
				"PATCH /transactions/:transactionId/suspicious error",
				err
			);
			return sendError(res, 500, "Internal server error");
		}
	}
);

// Ariel's subrouter for transactions/processed
// keep in separate file for now to avoid complicated merge conflicts but can be put in transactions later
const transactionsProcessedRouter = require('./transactions_processed');
router.use('/', transactionsProcessedRouter);

module.exports = router;
