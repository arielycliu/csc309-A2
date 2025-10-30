const { expressjwt: jwt } = require('express-jwt');
require('dotenv').config();

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
});

function requireClearance(minClearance) {
  if (minClearance === CLEARANCE.ANY) return (req, _res, next) => next();
  return [
    requireAuth,
    (req, res, next) => {
      const rank = roleRank(req.auth?.role);
      if (rank < minClearance) return res.status(403).json({ error: 'Forbidden' });
      next();
    },
  ];
}

module.exports = { CLEARANCE, requireClearance, requireAuth, roleRank };