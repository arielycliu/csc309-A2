const express = require("express");
const prisma = require('../../prisma');

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
          pointsTotal: pts, pointsRemained: pts, pointsAwarded: 0,
          published: false,
          createdBy: createdBy,
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


// sub-routers to be implemented
router.use('/:eventId/organizers', organizersRouter);
router.use('/:eventId/guests', guestsRouter);
router.use('/:eventId/transactions', eventTxRouter);

module.exports = router;