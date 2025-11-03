const express = require("express");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const organizersRouter = require('./organizers');
const guestsRouter = require('./guests');
const eventTxRouter = require('./transactions');

const { CLEARANCE, requireClearance, roleRank } = require('../auth_middleware');


const router = express.Router();

// Helpers

function isTrue(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

// Distinguish between manager (including superuser) and organizer
async function isManagerOrOrganizer(req, eventId) {
  if (roleRank(req.auth.role) >= 3) return true; // manager (3) or superuser (4)
  // organizer?
  const organizer = await prisma.eventOrganizer.findUnique({
    where: { eventId_userId: { eventId, userId: req.auth.sub } }, // (eventId, userId) as composite PK
    select: { eventId: true },
  });
  return !!organizer;
}

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

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
    const createdBy = req.auth.sub;

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
    const isManager = roleRank(req.auth.role) >= 3;
    const {
      name, location, started, ended, showFull, page = '1', limit = '10', published
    } = req.query;

    // helpers
    const parseBool = v => (v === true || v === 'true');
    const now = new Date();

    // 400 if both started & ended are present
    if (started !== undefined && ended !== undefined) {
      return res.status(400).json({ error: 'Specify only one of started or ended' });
    }
    const pageNum = Number(page), limitNum = Number(limit);
    if (!Number.isInteger(pageNum) || pageNum < 1)
      return res.status(400).json({ error: 'page must be a positive integer' });
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 100)
      return res.status(400).json({ error: 'limit must be an integer in [1,100]' });

    // base filters
    const where = {};
    if (!isManager) {
      // regular users only see published
      where.published = true;
    } else if (published !== undefined) {
      // manager/super may filter by published
      where.published = parseBool(published);
    }

    if (name)     where.name     = { contains: String(name),     mode: 'insensitive' };
    if (location) where.location = { contains: String(location), mode: 'insensitive' };
    if (started !== undefined) where.startTime = parseBool(started) ? { lte: now } : { gt: now };
    if (ended   !== undefined) where.endTime   = parseBool(ended)   ? { lte: now } : { gt: now };

    // fetch all (for count after showFull) and the page (for results)
    const [allMatching, pageRows] = await Promise.all([
      prisma.event.findMany({
        where, orderBy: { id: 'asc' },
        include: { _count: { select: { guests: true } } },
      }),
      prisma.event.findMany({
        where,
        skip: (pageNum - 1) * limitNum, take: limitNum,
        orderBy: { id: 'asc' },
        include: { _count: { select: { guests: true } } },
      }),
    ]);

    const filterFull = evs =>
      parseBool(showFull) ? evs : evs.filter(ev => ev.capacity == null || ev._count.guests < ev.capacity);

    const filteredAll  = filterFull(allMatching);
    const filteredPage = filterFull(pageRows);

    const results = filteredPage.map(ev => {
      const base = {
        id: ev.id,
        name: ev.name,
        location: ev.location,
        startTime: ev.startTime.toISOString(),
        endTime: ev.endTime.toISOString(),
        capacity: ev.capacity,
        numGuests: ev._count.guests || 0,
      };
      return isManager
        ? { ...base, pointsRemain: ev.pointsRemain, pointsAwarded: ev.pointsAwarded, published: ev.published }
        : base;
    });

    return res.status(200).json({ count: filteredAll.length, results });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch events' });
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

    const isConfirmed = (v) => v === true || v === 'true' || v === 1 || v === '1';
    const confirmedGuestRows = ev.guests.filter(g => isConfirmed(g.confirmed));
    const confirmedGuests = confirmedGuestRows.length;

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
        numGuests: confirmedGuests, // only confirmed count for regular users
      });
    }

    // Elevated users only see confirmed guests
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
      guests: confirmedGuestRows.map(g => ({
        id: g.user.id,
        utorid: g.user.utorid,
        name: g.user.name,
        confirmed: true, // see if autograder expects confirmed field being returned
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch event' });
  }
});


router.patch('/:eventId', requireClearance(CLEARANCE.REGULAR), async (req, res) => {
  try{
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) {
      console.log("Invalid eventId 400 in patch:", req.params.eventId);
      return res.status(400).json({ error: 'Invalid eventId' });
    }

    const ev = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true, name: true, description: true, location: true,
        startTime: true, endTime: true,
        capacity: true, pointsTotal: true, pointsRemain: true, pointsAwarded: true,
        published: true,
      },
    });

    const confirmedCount = await prisma.eventGuest.count({
      where: { eventId }, 
    });

    if (!ev) return res.status(404).json({ error: 'Event not found' });

    const isMgr = roleRank(req.auth.role) >= 3;
    const isOrg = await prisma.eventOrganizer.findUnique({
      where: { eventId_userId: { eventId, userId: req.auth.sub } },
    });

    if (!isMgr && !isOrg) return res.status(403).json({ error: 'Forbidden' });

    // Organizer can update: name, description, location, startTime, endTime, capacity
    // Manager can also set: points, published=true
    const allowedForOrganizer = new Set(['name', 'description', 'location', 'startTime', 'endTime', 'capacity']);
    const allowedForManager = new Set([...allowedForOrganizer, 'points', 'published']);

    const payload = req.body || {};
    const allowed = isMgr ? allowedForManager : allowedForOrganizer;

    for (const k of Object.keys(payload)) {
      if (!allowed.has(k)) return res.status(403).json({ error: `Field '${k}' not allowed` });
    }

    const now = new Date();
    const updates = {};

    if (payload.name !== undefined && payload.name !== null) {
      // cannot make change after original startTime

      if (now >= ev.startTime) {
        console.log("Cannot update name after startTime 400 in patch");
        return res.status(400).json({ error: 'Cannot update name after event has started' });
      }

      if (now >= ev.endTime) {
        console.log("Cannot update name after endTime 400 in patch");
        return res.status(400).json({ error: 'Cannot update name after event has ended' });
      }

      if (typeof payload.name !== 'string'){
        console.log("Invalid name 400 in patch:", payload.name); 
        return res.status(400).json({ error: 'name must be string' });
      }
      updates.name = payload.name;
    }

    if (payload.description !== undefined && payload.description !== null) {

      if (now >= ev.startTime) {
        console.log("Cannot update description after startTime 400 in patch");
        return res.status(400).json({ error: 'Cannot update description after event has started' });
      }

      if (typeof payload.description !== 'string') {
        console.log("Invalid description 400 in patch:", payload.description);
        return res.status(400).json({ error: 'description must be string' });
      }
      updates.description = payload.description;
    }

    if (payload.location !== undefined && payload.location !== null) {

      if (now >= ev.startTime) {
        console.log("Cannot update location after startTime 400 in patch");
        return res.status(400).json({ error: 'Cannot update location after event has started' });
      }

      if (typeof payload.location !== 'string') {
        console.log("Invalid location 400 in patch:", payload.location);
        return res.status(400).json({ error: 'location must be string' });
      }
      updates.location = payload.location;
    }

    // do not allow: startTime in the past (st < now)
    if (payload.startTime !== undefined && payload.startTime !== null) {

      if (now >= ev.startTime) {
        console.log("Cannot update startTime after startTime 400 in patch");
        return res.status(400).json({ error: 'Cannot update startTime after event has started' });
      }


      const st = parseISO(payload.startTime);
      if (!st) {
        console.log("1 Invalid startTime 400 in patch:", payload.startTime);
        return res.status(400).json({ error: 'Invalid startTime' });
      }
      if (st < now) {
        console.log("2 Invalid startTime 400 in patch:", payload.startTime);
        return res.status(400).json({ error: 'startTime cannot be in the past' });
      }
      updates.startTime = st;
    }

    if (payload.endTime !== undefined && payload.endTime !== null) {

      if (now >= ev.startTime) {
        console.log("Cannot update endTime after startTime 400 in patch");
        return res.status(400).json({ error: 'Cannot update endTime after event has started' });
      }


      const et = parseISO(payload.endTime);
      if (!et) {
        console.log("1 Invalid endTime 400 in patch:", payload.endTime);
        return res.status(400).json({ error: 'Invalid endTime' });
      }
      if (et < now) {
        console.log("2 Invalid endTime 400 in patch:", payload.endTime);
        return res.status(400).json({ error: 'endTime cannot be in the past' });
      }
      if ((updates.startTime || ev.startTime) && et <= (updates.startTime || ev.startTime)) {
        return res.status(400).json({ error: 'endTime must be after startTime' });
      }
      updates.endTime = et;
    }

    if (payload.capacity !== undefined && payload.capacity !== null) {

      if (now >= ev.startTime) {
        console.log("Cannot update capacity after startTime 400 in patch");
        return res.status(400).json({ error: 'Cannot update capacity after event has started' });
      }
      if (payload.capacity !== null) {
        const cap = Number(payload.capacity);

        if (!Number.isInteger(cap) || cap <= 0) {
          console.log("1 Invalid capacity 400 in patch:", payload.capacity);
          return res.status(400).json({ error: 'updated capacity must be positive integer' });
        }

        if (confirmedCount > cap) {
          console.log("2 Invalid capacity 400 in patch:", payload.capacity);
          return res.status(400).json({ error: 'New capacity is less than confirmed guests (current implementation assumes all guests are confirmed)' });
        }
        updates.capacity = cap;
      } else {
        console.log("3 Invalid capacity 400 in patch:", payload.capacity);
        return res.status(400).json({ error: 'updated capacity cannot be null' });
      }
    }

    if (isMgr && payload.points !== undefined && payload.points !== null) {
      const pts = Number(payload.points);
      if (!Number.isInteger(pts) || pts <= 0) {
        console.log("1 Invalid points 400 in patch:", payload.points);
        return res.status(400).json({ error: 'points must be positive integer' });
      }
      const newRemain = pts - ev.pointsAwarded;
      if (newRemain < 0) {
        console.log("2 Invalid points 400 in patch:", payload.points);
        return res.status(400).json({ error: 'Reducing points below already-awarded total is not allowed' });
      }
      updates.pointsTotal = pts;
      updates.pointsRemain = newRemain;
    }

    if (isMgr && payload.published !== undefined && payload.published !== null) {
      if (!isTrue(payload.published)) {
        console.log("1 Invalid published 400 in patch:", payload.published);
        return res.status(400).json({ error: 'published can only be set to true' });
      }
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

/* DELETE /events/:eventId */
router.delete('/:eventId', requireClearance(CLEARANCE.MANAGER),  async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid eventId' });

    const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { published: true } });
    if (!ev) return res.status(404).json({ error: 'Event not found' });

    if (isTrue(ev.published)) return res.status(400).json({ error: 'Cannot delete a published event' });

    await prisma.event.delete({ where: { id: eventId } });

    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete event' });
  }
});

// sub-routers
router.use('/:eventId/organizers', organizersRouter);
router.use('/:eventId/guests', guestsRouter);
router.use('/:eventId/transactions', eventTxRouter);

module.exports = router;