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

function validatePayload(schema){
  // pass in schema to validate ex. => { fieldName: {type: 'string', required: true/false }}
  return(req, res, next) => {
    const errors = [];
    
    for(const [fieldName, config] of Object.entries(schema)){
      const value = req.body[fieldName]
      const {type, required} = config;

      if(required && (value === undefined || value === null || value === '')){
        errors.push(`Missing required Field: ${field}`);
      }

      if(value !== undefined && typeof value !== type){
        errors.push(`Field "${fieldName}" must be of type ${type}`)
      }
    }

    if(errors.length){
      return res.status(400).json({error: errors});
    }

    next();
  }
}

module.exports = { CLEARANCE, requireClearance, requireAuth, roleRank, validatePayload};