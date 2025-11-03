const express = require('express');
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { CLEARANCE, requireClearance, roleRank, requireClearanceUpdateRole } = require('../auth_middleware');

const router = express.Router({ mergeParams: true });

async function isOrganizer(userId, eventId) {
  const org = await prisma.eventOrganizer.findUnique({
    where: { eventId_userId: { eventId, userId } },
    select: { eventId: true },
  });
  return !!org;
}

/* POST /events/:eventId/guests  (Manager or Organizer) */
router.post('/', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid eventId' });

    const ev = await prisma.event.findUnique({ where: { id: eventId }, include: { _count: { select: { guests: true } } } });
    if (!ev) return res.status(404).json({ error: 'Event not found' });

    const isMgr = roleRank(req.auth.role) >= 3;
    const isOrg = await isOrganizer(req.auth.sub, eventId);
    if (!isMgr && !isOrg) return res.status(403).json({ error: 'Forbidden' });

    const { utorid } = req.body || {};
    if (!utorid) return res.status(400).json({ error: 'utorid required' });

    if (new Date() > ev.endTime) return res.status(410).json({ error: 'Event has ended' });
    if (ev.published === false && !isMgr) return res.status(404).json({ error: 'Event not visible yet. You are just an ORGANIZER' });

    const user = await prisma.user.findUnique({ where: { utorid } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // guests cannot be organizers
    const isUserOrganizer = await isOrganizer(user.id, eventId);
    if (isUserOrganizer) return res.status(400).json({ error: 'User is an organizer; remove organizer role first' });

    // capacity
    if (ev.capacity != null && ev._count.guests >= ev.capacity) { // assume all guests in EventGuest are confirmed (confirmed default true)
      return res.status(410).json({ error: 'Event is full' });
    }

    const created = await prisma.eventGuest.create({
      data: { eventId, userId: user.id, confirmed: true },
      include: { user: { select: { id: true, utorid: true, name: true } } },
    });

    return res.status(201).json({
      id: ev.id,
      name: ev.name,
      location: ev.location,
      guestAdded: { id: created.user.id, utorid: created.user.utorid, name: created.user.name },
      numGuests: ev._count.guests + 1,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to add guest' });
  }
});

/* DELETE /events/:eventId/guests/me  (REGULAR self-unRSVP) */
router.delete('/me', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid eventId' });

    const ev = await prisma.event.findUnique({ where: { id: eventId } });
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    if (new Date() > ev.endTime) return res.status(410).json({ error: 'Event has ended' });

    const guest = await prisma.eventGuest.findFirst({ where: { eventId, userId: req.auth.sub } });
    if (!guest) return res.status(404).json({ error: 'Not on guest list' });

    await prisma.eventGuest.delete({ where: { id: guest.id } });
    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ error: 'Failed to un-RSVP' });
  }
});


/* DELETE /events/:eventId/guests/:userId  (Manager only) */
router.delete('/:userId', requireClearance(CLEARANCE.MANAGER), async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(eventId) || !Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid ids' });

    const ev = await prisma.event.findUnique({ where: { id: eventId } });
    if (!ev) return res.status(404).json({ error: 'Event not found' });

    const guest = await prisma.eventGuest.findFirst({ where: { eventId, userId } });
    if (!guest) return res.status(404).json({ error: 'Guest not found' });

    await prisma.eventGuest.delete({ where: { id: guest.id } });
    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ error: 'Failed to remove guest' });
  }
});

/* POST /events/:eventId/guests/me  (REGULAR self-RSVP) */
router.post('/me', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid eventId' });

    const ev = await prisma.event.findUnique({ where: { id: eventId }, include: { _count: { select: { guests: true } } } });
    if (!ev) return res.status(404).json({ error: 'Event not found' });
    if (!ev.published) return res.status(404).json({ error: 'Event not found. Not published yet. (eventId/guests/me)' }); // hidden from regular users
    if (new Date() > ev.endTime) return res.status(410).json({ error: 'Event has ended' });

    // cannot RSVP if organizer
    const isOrg = await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId, userId: req.auth.sub } },
    });
    if (isOrg) return res.status(400).json({ error: 'Organizers cannot RSVP as guests' });

    // capacity
    if (ev.capacity != null && ev._count.guests >= ev.capacity) {
      return res.status(410).json({ error: 'Event is full' });
    }

    const exists = await prisma.eventGuest.findFirst({ where: { eventId, userId: req.auth.sub } });
    if (exists) return res.status(400).json({ error: 'Already on guest list' });

    const me = await prisma.user.findUnique({ where: { id: req.auth.sub }, select: { id: true, utorid: true, name: true } });
    const added = await prisma.eventGuest.create({ data: { eventId, userId: req.auth.sub, confirmed: true } });

    return res.status(201).json({
      id: ev.id,
      name: ev.name,
      location: ev.location,
      guestAdded: { id: me.id, utorid: me.utorid, name: me.name },
      numGuests: ev._count.guests + 1,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to RSVP' });
  }
});

// /* DELETE /events/:eventId/guests/me  (REGULAR self-unRSVP) */
// router.delete('/me', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
//   try {
//     const eventId = Number(req.params.eventId);
//     if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid eventId' });

//     const ev = await prisma.event.findUnique({ where: { id: eventId } });
//     if (!ev) return res.status(404).json({ error: 'Event not found' });
//     if (new Date() > ev.endTime) return res.status(410).json({ error: 'Event has ended' });

//     const guest = await prisma.eventGuest.findFirst({ where: { eventId, userId: req.auth.sub } });
//     if (!guest) return res.status(404).json({ error: 'Not on guest list' });

//     await prisma.eventGuest.delete({ where: { id: guest.id } });
//     return res.status(204).send();
//   } catch (e) {
//     return res.status(500).json({ error: 'Failed to un-RSVP' });
//   }
// });

module.exports = router;
