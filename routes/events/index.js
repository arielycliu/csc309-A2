const express = require("express");
const prisma = require('../../prisma'); // assume prisma.js

// To be implemented
const organizersRouter = require('./organizers');
const guestsRouter = require('./guests');
const eventTxRouter = require('./transactions');

// assume auth middleware is ready
const { CLEARANCE, requireClearance, roleRank } = require('../../config/auth');


const router = express.Router();

// Helpers

// Distinguish between manager (including superuser) and organizer
async function isManagerOrOrganizer(req, eventId) {
  if (roleRank(req.auth.role) >= 3) return true; // manager (3) or superuser (4)
  // organizer?
  const organizer = await prisma.eventOrganizer.findUnique({
    where: { eventId_userId: { eventId, userId: req.auth.uid } }, // (eventId, userId) as composite PK
    select: { eventId: true },
  });
  return !!organizer;
}

function parseISO(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}


/* POST Create Event */
router.post("/", requireClearance(CLEARANCE.MANAGER), async (req, res) => {
  try {
    const { name, description, location, startTime, endTime, capacity, points } = req.body || {};

    // Validate required fields

    // Check fields
    if (!name || !description || !location || !startTime || !endTime || points === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (typeof name !== 'string' || typeof description !== 'string' || typeof location !== 'string') {
      return res.status(400).json({ error: 'Invalid field types' });
    }

    // Check time fields
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    if (!start || !end) return res.status(400).json({ error: 'Invalid startTime or endTime (ISO 8601 required)' });
    if (end <= start) return res.status(400).json({ error: 'endTime must be after startTime' });

    // Check capacity
    let cap = null;
    if (capacity !== undefined && capacity !== null) {
      // capacity must be a number here
      const capNum = Number(capacity);
      if (!Number.isFinite(capNum) || capNum <= 0 || Math.floor(capNum) !== capNum) {
        return res.status(400).json({ error: 'capacity must be a positive integer or null' });
      }
      cap = capNum;
    }

    // Check points
    const pts = Number(points);
    if (!isPositiveInt(pts)) return res.status(400).json({ error: 'points must be a positive integer' });

    // CreatedBy
    const createdBy = req.auth.uid;

    // Create the event
    const created = await prisma.event.create({
        data: {
          name, description, location,
          startTime: start, endTime: end,
          capacity: cap,
          pointsTotal: pts, pointsRemain: pts, pointsAwarded: 0,
          published: false,
          createdById: createdBy,
        },
      });

    return res.status(201).json({
      id: created.id,
      name: created.name,
      description: created.description,
      location: created.location,
      startTime: created.startTime.toISOString(),
      endTime: created.endTime.toISOString(),
      capacity: created.capacity,
      pointsRemain: created.pointsRemain,
      pointsAwarded: created.pointsAwarded,
      published: created.published,
      organizers: [],
      guests: [],
    });

  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).json({ error: "Failed to create event" });
  }


}
);

// Get
router.get('/', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
  try {
    const isManagerView = roleRank(req.auth.role) >= 3;
    const { name, location, started, ended, showFull, page = 1, limit = 10, published } = req.query;

    if (started !== undefined && ended !== undefined) {
      return res.status(400).json({ error: 'Specify only one of started or ended' });
    }

    const now = new Date();
    const where = {};
    // Filter based on published status

    // if not manager/superuser view, only show published events
    if (!isManagerView) where.published = true;
    // if manager view, can filter by published status
    else if (published !== undefined) where.published = String(published) === 'true';
    // Other filters
    if (name) where.name = { contains: String(name), mode: 'insensitive' };
    if (location) where.location = { contains: String(location), mode: 'insensitive' };
    if (started !== undefined) where.startTime = (String(started) === 'true') ? { lte: now } : { gt: now };
    if (ended !== undefined) where.endTime = (String(ended) === 'true') ? { lte: now } : { gt: now };

    if (String(started) === 'true' && String(ended) === 'true') {
      return res.status(400).json({ error: 'Cannot filter by both started and ended being true' });
    }

    const take = Math.max(1, Math.min(100, Number(limit))); // Avoid too large limits (not sure if necessary with in this assignment)
    const skip = (Math.max(1, Number(page)) - 1) * take;

    // Count here is total matching before filtering full events
    const [count, rows] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where, skip, take, orderBy: { id: 'asc' },
        include: { _count: { select: { guests: true } } },
      }),
    ]);

    // If showFull is false, filter out full events
    let filteredRows = rows;
    if (String(showFull || 'false') === 'false') {
      // Now, filteredRows only include events where capacity is null or numGuests < capacity
      filteredRows = rows.filter(ev => (ev.capacity == null) || (ev._count.guests < ev.capacity));
    }

    const results = filteredRows.map(ev => {
      const base = {
        id: ev.id,
        name: ev.name,
        location: ev.location,
        startTime: ev.startTime.toISOString(),
        endTime: ev.endTime.toISOString(),
        capacity: ev.capacity,
        numGuests: ev._count.guests || 0,
      };
      return isManagerView ? { ...base, pointsRemain: ev.pointsRemain, pointsAwarded: ev.pointsAwarded, published: ev.published } : base;
    });

    const adjustedCount = (String(showFull || 'false') === 'false') ? results.length : count;
    return res.status(200).json({ count: adjustedCount, results });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch events (Exception in events GET)' });
  }
});

// Get /:eventId
router.get('/:eventId', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid eventId' });

    const ev = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organizers: { include: { user: { select: { id: true, utorid: true, name: true } } } },
        guests: { include: { user: { select: { id: true, utorid: true, name: true } } } },
        _count: { select: { guests: true } },
      },
    });
    if (!ev) return res.status(404).json({ error: 'Event not found (Not created yet)' }); 

    // count guests that are confirmed
    const confirmedGuests = ev.guests.filter(g => g.confirmed).length;

    const elevated = await isManagerOrOrganizer(req, eventId);
    if (!elevated) {
      if (!ev.published) return res.status(404).json({ error: 'Event not found (not published)' });
      return res.status(200).json({
        id: ev.id,
        name: ev.name,
        description: ev.description,
        location: ev.location,
        startTime: ev.startTime.toISOString(),
        endTime: ev.endTime.toISOString(),
        capacity: ev.capacity,
        organizers: ev.organizers.map(o => ({ id: o.user.id, utorid: o.user.utorid, name: o.user.name })),
        numGuests: confirmedGuests,
      });
    }

    return res.status(200).json({
      id: ev.id,
      name: ev.name,
      description: ev.description,
      location: ev.location,
      startTime: ev.startTime.toISOString(),
      endTime: ev.endTime.toISOString(),
      capacity: ev.capacity,
      pointsRemain: ev.pointsRemain,
      pointsAwarded: ev.pointsAwarded,
      published: ev.published,
      organizers: ev.organizers.map(o => ({ id: o.user.id, utorid: o.user.utorid, name: o.user.name })),
      guests: ev.guests.map(g => ({ id: g.user.id, utorid: g.user.utorid, name: g.user.name, confirmed: g.confirmed === 'true' })),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch event' });
  }
});

router.patch('/:eventId', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
  try{
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid eventId' });

    const ev = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        _count: {
          select: {
            guests: {
              where: { confirmed: true },
            },
          },
        },
      },
    });

    if (!ev) return res.status(404).json({ error: 'Event not found' });

    const isMgr = roleRank(req.auth.role) >= 3;
    const isOrg = await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId, userId: req.auth.uid } },
    });

    if (!isMgr && !isOrg) return res.status(403).json({ error: 'Forbidden' });

    // Organizer can update: name, description, location, startTime, endTime, capacity
    // Manager can also set: points (reallocate, with constraints), published=true
    const allowedForOrganizer = new Set(['name', 'description', 'location', 'startTime', 'endTime', 'capacity']);
    const allowedForManager = new Set([...allowedForOrganizer, 'points', 'published']);

    const payload = req.body || {};
    const allowed = isMgr ? allowedForManager : allowedForOrganizer;

    for (const k of Object.keys(payload)) {
      if (!allowed.has(k)) return res.status(403).json({ error: `Field '${k}' not allowed` });
    }

    const now = new Date();
    const updates = {};

    if (payload.name !== undefined) {
      if (typeof payload.name !== 'string') return res.status(400).json({ error: 'name must be string' });
      updates.name = payload.name;
    }

    if (payload.description !== undefined) {
      if (typeof payload.description !== 'string') return res.status(400).json({ error: 'description must be string' });
      updates.description = payload.description;
    }

    if (payload.location !== undefined) {
      if (typeof payload.location !== 'string') return res.status(400).json({ error: 'location must be string' });
      updates.location = payload.location;
    }

    // do not allow: startTime in the past (st < now)
    if (payload.startTime !== undefined) {
      const st = parseISO(payload.startTime);
      if (!st) return res.status(400).json({ error: 'Invalid startTime' });
      if (st < now) return res.status(400).json({ error: 'startTime cannot be in the past' });
      updates.startTime = st;
    }

    if (payload.endTime !== undefined) {
      const et = parseISO(payload.endTime);
      if (!et) return res.status(400).json({ error: 'Invalid endTime' });
      if (et < now) return res.status(400).json({ error: 'endTime cannot be in the past' });
      if ((updates.startTime || ev.startTime) && et <= (updates.startTime || ev.startTime)) {
        return res.status(400).json({ error: 'endTime must be after startTime' });
      }
      updates.endTime = et;
    }

    if (payload.capacity !== undefined) {
      if (payload.capacity !== null) {
        const cap = Number(payload.capacity);
        if (!Number.isInteger(cap) || cap <= 0) return res.status(400).json({ error: 'updated capacity must be positive integer' });
        if (ev._count.guests > cap) return res.status(400).json({ error: 'New capacity is less than confirmed guests' });
        updates.capacity = cap;
      } else {
        return res.status(400).json({ error: 'updated capacity cannot be null' });
      }
    }

    if (isMgr && payload.points !== undefined) {
      const pts = Number(payload.points);
      if (!Number.isInteger(pts) || pts <= 0) return res.status(400).json({ error: 'points must be positive integer' });
      const newRemain = pts - ev.pointsAwarded;
      if (newRemain < 0) return res.status(400).json({ error: 'Reducing points below already-awarded total is not allowed' });
      updates.pointsTotal = pts;
      updates.pointsRemain = newRemain;
    }

    if (isMgr && payload.published !== undefined) {
      if (payload.published !== true) return res.status(400).json({ error: 'published can only be set to true' });
      updates.published = true;
    }

    const updated = await prisma.event.update({ where: { id: eventId }, data: updates });

    const resp = { id: updated.id, name: updated.name, location: updated.location };
    for (const k of Object.keys(updates)) {
      const v = updated[k];
      resp[k] = (v instanceof Date) ? v.toISOString() : v;
    }

    return res.json(resp);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to update event' });
  }
});

// sub-routers to be implemented
router.use('/:eventId/organizers', organizersRouter);
router.use('/:eventId/guests', guestsRouter);
router.use('/:eventId/transactions', eventTxRouter);

module.exports = router;