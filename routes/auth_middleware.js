const { expressjwt: jwt } = require('express-jwt');
require('dotenv').config();
const { PrismaClient} = require('@prisma/client');
const prisma = new PrismaClient();

const CLEARANCE = {
  ANY: 0,
  REGULAR: 1,
  CASHIER: 2,
  MANAGER: 3,
  SUPERUSER: 4,   
};

function roleRank(role) {        
  switch (role) {
    case 'superuser': return CLEARANCE.SUPERUSER;
    case 'manager':   return CLEARANCE.MANAGER;
    case 'cashier':   return CLEARANCE.CASHIER;
    case 'regular':   return CLEARANCE.REGULAR;
    default:          return -1;
  }
}

const requireAuth = jwt({
  secret: process.env.JWT_SECRET,
  algorithms: ['HS256'],
}); // by default, auth is attached to req -> req.auth



async function attachUser(req, res, next) {
  try {
    const userId = Number(req.auth?.sub);              // sub from the token
    if (!Number.isInteger(userId)) {
      console.log("attachUser received invalid userID:", userId);
      return res.status(401).json({ error: 'Invalid token subject' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, utorid: true, role: true, verified: true, suspicious: true },
    });
    if (!user) return res.status(401).json({ error: 'User not found' });

    req.user = user; // keep it just in case                        
    // overwrite req.auth with fresh info from DB
    req.auth = {
      ...(req.auth || {}),
      uid: user.id,
      utorid: user.utorid,
      role: user.role,                      
    };
    next();
  } catch (e) {
    next(e);
  }
}


// updated requireClearance to use async attachUser to update user role from DB
function requireClearance(minClearance) {
  if (minClearance === CLEARANCE.ANY) return (req, _res, next) => next();
  return [
    requireAuth,
    attachUser,
    (req, res, next) => {
      const rank = roleRank(req.auth?.role);
      if (rank < minClearance){
        console.log(`User ${req.auth?.uid} does not have enough clearance: ${rank} < ${minClearance}`);
        console.log('User role:', req.auth?.role);
        console.log('Required clearance:', minClearance);
        console.log('input req.auth:', req.auth);
        console.log('input url:', req.originalUrl);
        return res.status(403).json({ error: 'Forbidden' })
      };
      next();
    },
  ];
}

function validatePayload(schema) {
  return (req, res, next) => {
    try {
      if (req.method === "GET") {
        req.query = schema.parse(req.query);
      } else {
        req.body = schema.parse(req.body);
      }
      next();
    } catch (err) {
      // ZodError
      
      const errors = err.errors.map(e => `${e.path.join('.')} - ${e.message}`);
      return res.status(400).json({ error: errors });
    }
  };
}

function requireClearanceUpdateRole(minClearance) {
  if (minClearance === CLEARANCE.ANY) return (req, _res, next) => next();
  return [
    requireAuth,
    async (req, res, next) => {

      if (!req.auth?.sub) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const user = await prisma.user.findUnique({
        where: { id: req.auth.sub },
        select: { role: true },
      });
      
      if (!user)
        return res.status(403).json({ error: 'forbidden' });

      const userRank = roleRank(user.role);
      if (userRank < minClearance)
        return res.status(403).json({ error: 'Forbidden' });


      // update the role in case it changed
      req.auth.role = user.role;

      next();
    },
  ];
}


module.exports = { CLEARANCE, requireClearance, requireAuth, roleRank, validatePayload, requireClearanceUpdateRole, attachUser};

// temp_middleware.js
// require('dotenv').config();
// const { expressjwt: jwt } = require('express-jwt');

// const CLEARANCE = {
//   ANY: 0,
//   REGULAR: 1,
//   CASHIER: 2,
//   MANAGER: 3,
//   SUPERUSER: 4,
// };

// function roleRank(role) {
//   switch (String(role)) {
//     case 'superuser': return CLEARANCE.SUPERUSER;
//     case 'manager':   return CLEARANCE.MANAGER;
//     case 'cashier':   return CLEARANCE.CASHIER;
//     case 'regular':   return CLEARANCE.REGULAR;
//     default:          return CLEARANCE.ANY;
//   }
// }

// function authGuard() {
//   if (process.env.TEST_MODE) {
//     // BYPASS: every request becomes a superuser with id=1
//     return (req, _res, next) => {
//       if (!req.auth) {
//         req.auth = { uid: 1, role: 'superuser', utorid: 'testsu' };
//       }
//       next();
//     };
//   }

//   const secret = process.env.JWT_SECRET;
//   if (!secret) {
//     console.warn('JWT_SECRET not set; all protected routes will 401.');
//   }

//   return jwt({
//     secret,
//     algorithms: ['HS256'],
//     requestProperty: 'auth', // decoded payload goes to req.auth
//     getToken: (req) => {
//       const h = req.headers['authorization'] || req.headers['Authorization'];
//       if (!h) return null;
//       const parts = String(h).split(' ');
//       return parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : null;
//     },
//   });
// }

// function requireClearance(minRank) {
//   return [
//     authGuard(),
//     (req, res, next) => {
//       if (!req.auth) {
//         return res.status(401).json({ error: 'Unauthorized' });
//       }
//       const rank = roleRank(req.auth.role);
//       if (rank < minRank) {
//         return res.status(403).json({ error: 'Forbidden' });
//       }
//       next();
//     },
//   ];
// }

// module.exports = {
//   CLEARANCE,
//   roleRank,
//   requireClearance,
// };
