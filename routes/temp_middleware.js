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

// function validatePayload(schema){ //testing functionality
//   // pass in schema to validate ex. => { fieldName: {type: 'string', values:[],  required: true/false }}
//   return(req, res, next) => {
//     const errors = [];
    
//     for(const [fieldName, config] of Object.entries(schema)){
//       const value = req.body[fieldName]
//       const {type, required, values} = config;

//       if(required && (value === undefined || value === null || value === '')){
//         errors.push(`Missing required Field: ${field}`);
//       }

//       if (type === 'enum') {
//         if (!values.includes(value)) {
//           errors.push(`Field "${field}" must be one of [${values.join(', ')}]`);
//         }
//       } else if (typeof value !== type) {
//         errors.push(`Field "${field}" must be of type ${type}`);
//       }
//     }

//     if(errors.length){
//       return res.status(400).json({error: errors});
//     }

//     next();
//   }
// }

module.exports = { CLEARANCE, requireClearance, requireAuth, roleRank};

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
