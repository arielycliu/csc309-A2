const express = require('express');
const { PrismaClient, TransactionType } = require('@prisma/client');
const prisma = new PrismaClient();
const { CLEARANCE, requireClearance, roleRank } = require('../auth_middleware');

const router = express.Router({ mergeParams: true });

async function isManagerOrOrganizer(req, eventId) {
  if (roleRank(req.auth.role) >= 3) return true;
  const org = await prisma.eventOrganizer.findUnique({
    where: { eventId_userId: { eventId, userId: req.auth.sub } },
  });
  return !!org;
}

/* POST /events/:eventId/transactions  — award points
   Clearance: Manager+ OR Organizer
   Rules:
   - Only award to guests with confirmed=true
   - pointsRemain
*/
router.post('/', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) {
      console.error('Invalid eventId in event transactions:', req.params.eventId);
      return res.status(400).json({ error: 'Invalid eventId' });
    }

    const { type, utorid, amount, remark } = req.body || {};
    if (type && type !== 'event') {
      console.error('Invalid transaction type in event transactions:', type);
      return res.status(400).json({ error: 'type must be "event"' });
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      console.error('Invalid transaction amount in event transactions:', amount);
      return res.status(400).json({ error: 'amount must be positive integer' });
    }

    // Only manager/superuser or organizer of this event may proceed
    const canAward = await isManagerOrOrganizer(req, eventId);
    if (!canAward) return res.status(403).json({ error: 'Forbidden (event transaction)' });

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Build recipients = confirmed guests only
    let recipients = [];
    if (utorid) {
      const user = await prisma.user.findUnique({ where: { utorid } });
      if (!user) return res.status(404).json({ error: 'Recipient not found' });

      const eg = await prisma.eventGuest.findFirst({
        where: { eventId, userId: user.id},
      });
      if (!eg) {
        console.error('User is not a confirmed guest:', user);
        return res.status(400).json({ error: 'User is not a confirmed guest' });
      }

      recipients = [user];
    } else {
      const confirmedGuests = await prisma.eventGuest.findMany({
        where: { eventId },
        include: { user: { select: { id: true, utorid: true } } },
      });
      if (confirmedGuests.length === 0) {
        console.error('No confirmed guests found for event:', eventId);
        return res.status(400).json({ error: 'No confirmed guests to award' });
      }
      recipients = confirmedGuests.map(g => g.user);
    }

    const total = recipients.length * amount;
    if (event.pointsRemain < total) {
      console.error('Insufficient remaining points for event:', eventId);
      return res.status(400).json({ error: 'Insufficient remaining points for this event' });
    }

    const creatorId = req.auth.sub;

    // Get creator utorid for response 
    const creator = await prisma.user.findUnique({
      where: { id: creatorId },
      select: { utorid: true },
    });

    // Atomically
    const txRows = await prisma.$transaction(async (tx) => {
      const createdTxs = [];

      for (const r of recipients) {
        const row = await tx.transaction.create({
          data: {
            type: TransactionType.event,         
            userId: r.id,                        
            createdById: creatorId,              
            amount: amount,                      
            eventId: eventId,                   
            remark: remark || null,
          },
        });
        createdTxs.push(row);

        // Add points to recipient
        await tx.user.update({
          where: { id: r.id },
          data: { points: { increment: amount } },
        });
      }

      // Update event 
      await tx.event.update({
        where: { id: eventId },
        data: {
          pointsRemain: { decrement: total },
          pointsAwarded: { increment: total },
        },
      });

      return createdTxs;
    });

    // Build responses
    if (utorid) {
      const row = txRows[0];
      return res.status(201).json({
        id: row.id,
        recipient: utorid,
        awarded: amount,
        type: 'event',
        relatedId: eventId,
        remark: remark || '',
        createdBy: creator?.utorid || String(creatorId),
      });
    }

    return res.status(201).json(
      txRows.map((row, i) => ({
        id: row.id,
        recipient: recipients[i].utorid,
        awarded: amount,
        type: 'event',
        relatedId: eventId,
        remark: remark || '',
        createdBy: creator?.utorid || String(creatorId),
      }))
    );
  } catch (e) {
    console.error('event award error:', e);
    return res.status(500).json({ error: 'Failed to create event award transactions' });
  }
});

module.exports = router;
