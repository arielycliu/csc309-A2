const express = require('express');
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { CLEARANCE, requireClearance, roleRank } = require('../auth_middleware');

const router = express.Router({ mergeParams: true });

/* POST /events/:eventId/organizers  (Manager only) */
router.post('/', requireClearance(CLEARANCE.MANAGER), async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    const { utorid } = req.body || {};
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid eventId' });
    if (!utorid) return res.status(400).json({ error: 'utorid required' });

    const ev = await prisma.event.findUnique({ where: { id: eventId } });
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    if (new Date() > ev.endTime) return res.status(410).json({ error: 'Event has ended' });

    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // organizer cannot also be a guest
    const guest = await prisma.eventGuest.findFirst({ where: { eventId, userId: user.id } });
    if (guest) return res.status(400).json({ error: 'User is currently a guest; remove guest first' });

    await prisma.eventOrganizer.upsert({
      where: { eventId_userId: { eventId, userId: user.id } }, // composite pk
      update: {},
      create: { eventId, userId: user.id },
    });

    const organizers = await prisma.eventOrganizer.findMany({
      where: { eventId },
      include: { user: { select: { id: true, utorid: true, name: true } } },
      orderBy: { userId: 'asc' },
    });

    return res.status(201).json({
      id: ev.id,
      name: ev.name,
      location: ev.location,
      organizers: organizers.map(o => ({ id: o.user.id, utorid: o.user.utorid, name: o.user.name })),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to add organizer' });
  }
});

/* DELETE /events/:eventId/organizers/:userId  (Manager only) */
router.delete('/:userId', requireClearance(CLEARANCE.MANAGER), async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(eventId) || !Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid ids' });

    const ev = await prisma.event.findUnique({ where: { id: eventId } });
    if (!ev) return res.status(404).json({ error: 'Event not found' });

    const membership = await prisma.eventOrganizer.findUnique({ where: { eventId_userId: { eventId, userId } } });
    if (!membership) return res.status(404).json({ error: 'Organizer not found on this event' });

    await prisma.eventOrganizer.delete({ where: { eventId_userId: { eventId, userId } } });
    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ error: 'Failed to remove organizer' });
  }
});

module.exports = router;
