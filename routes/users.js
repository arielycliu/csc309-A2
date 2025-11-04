const { CLEARANCE, requireClearance, validatePayload} = require('./auth_middleware');
const { v4: uuidv4 } = require('uuid');
const {z} = require("zod");
const bcrypt = require('bcrypt');
const { PrismaClient} = require('@prisma/client');

const prisma = new PrismaClient();
const express = require("express");
const router = express.Router();


/* 
 notes: 
    need to figure out how to get promotions 
    line 180 promotions.js 
*/



const createUsersPayload = z.object({
    utorid: z.string().min(7, "must be atleast 7 characters long").max(8, "utorid too long"),
    name: z.string().min(1, "too short").max(50, "too long"),
    email: z.string().email("invalid email format").refine(val => val.endsWith("@mail.utoronto.ca"), {
        message: "must be of domain @mail.utoronto.ca"
    }),
});

router.post("/", requireClearance(CLEARANCE.CASHIER), validatePayload(createUsersPayload), async (req, res) => {
    
   //user authenticated as cashier or higher, required field checked 
   const {utorid, name, email} = req.body;


   //check user utorid and email for uniqueness
   const existing_user = await prisma.user.findFirst({
        where: {
            OR: [{email}, {utorid}]
        }
   });

   if(existing_user){
        const duplicatedField = existing_user.utorid === utorid  ? "utorid" : 'email';
        return res.status(409).json({error: `${duplicatedField} already exists`});
   }

   //create user 
   try{
        resetToken = uuidv4();
        expiresAtDate = new Date();
        expiresAtDate.setDate(expiresAtDate.getDate() + 7); //7 days 
        const resetExpiresAt = expiresAtDate.toISOString();
        const user = await prisma.user.create({
            data: {utorid, name, email, resetExpiresAt, resetToken},
            select: {id: true, utorid: true, name: true, email: true, verified: true, resetExpiresAt:true, resetToken:true}
        });
        // Return response with expiresAt instead of resetExpiresAt for consistency
        const response = {
            id: user.id,
            utorid: user.utorid,
            name: user.name,
            email: user.email,
            verified: user.verified,
            expiresAt: user.resetExpiresAt,
            resetToken: user.resetToken
        };
        return res.status(201).json(response);

   }catch(err){
        return res.status(500).json({error: `error creating user ${err.message}`});
   }
    
});

const getUsersPayload = z.object({
    name: z.string().optional().nullable(),
    role: z.enum(['regular', 'cashier', 'manager', 'superuser']).optional().nullable(),
    verified: z.string().optional().transform(val => val === undefined ? undefined : val === "true"),
    activated: z.string().optional().transform(val => val === undefined ? undefined : val === "true"),
    page: z.coerce.number().int().positive().optional().nullable(),
    limit: z.coerce.number().int().positive().optional().nullable()

});

router.get("/", requireClearance(CLEARANCE.MANAGER), validatePayload(getUsersPayload), async(req, res)=> {
    //console.log(req.query)
    // console.log({
    // body: req.body,
    // query: req.query,
    // params: req.params,
    // headers: req.headers,
    // method: req.method,
    // url: req.url
    // });

    //check which fields were included in request 
    const {name, role, verified, activated, page, limit} = req.query;
    const page_check = page|| 1;
    const take = limit || 10;
    const skip = (page_check - 1) * take;

    const where = {};

    if (name) where.name = name;
    if (role) where.role = role;
    
    if (verified !== undefined && verified !== null) where.verified = verified;
    if (activated !== undefined && activated !== null) {
        if (activated) {
            where.lastLogin = { not: {} };
        } else {
            where.lastLogin = null; 
        }
    }

    try{
        const count = await prisma.user.count({ where: where });
        const totalPages = Math.ceil(count / take);
        const users = await prisma.user.findMany({
            where, 
            skip, 
            take, 
            select: {id: true, utorid: true, name: true, email: true, 
                    birthday: true, role: true, points: true, createdAt: true, 
                    lastLogin: true, verified: true, avatarUrl: true}
        })
        return res.status(200).json({count: count, results: users});
    }catch(err){
        return res.status(500).json({error: `error getting users ${err.message}`});
    }

});

async function getUsersValidPromotions(user){
    promotions = [];

    //get user promotions 
    used_promotions = user.ownedTransactions;
    if(!used_promotions){
        return promotions;
    }
    used_prmotions_id = used_promotions.map(promotion => promotion.id);

    //console.log("promotions used", promotions_id);

    //get all promotions that are not these ids 
    promotions_found = await prisma.promotions.findMany({
        where: {
            id:{
                notIn: used_prmotions_id
            }
        },
        select: {
            id:true, name:true, minSpending:true, rate:true, points:true
        }
    });

    //console.log("promotions", promotions_found)

    if(promotions_found.length > 0){
        return promotions_found;
    }

    return promotions;
}

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const upload =  multer({ storage: multer.memoryStorage() });
const patchSelfPayload = z.object({
    name: z.string().min(1, "name too short").max(50, "name too long").optional().nullable(),
    email: z.string().email("invalid email format").refine(val => val.endsWith("@mail.utoronto.ca"), {
        message: "must be of domain @mail.utoronto.ca"
    }).optional().nullable(),
    birthday: z.string()
    .optional()
    .nullable()
    .refine((val) => {
    if (!val) return true; // allow null/undefined
        const date = new Date(val);
        if (isNaN(date.getTime())) return false; // invalid date
        const [year, month, day] = val.split("-").map(Number);
        return (
        date.getFullYear() === year &&
        date.getMonth() + 1 === month && 
        date.getDate() + 1 === day
        );
    }, "Birthday must be a valid date in YYYY-MM-DD format")
    
});

router.patch("/me", requireClearance(CLEARANCE.REGULAR), upload.single("avatar"), validatePayload(patchSelfPayload), async(req, res)=> {
    var data = {};
    const {name, email, birthday} = req.body;

    
    if(name) data.name = name;
    if(email){

        //check email still unique 
        const duplicate_email = await prisma.findFirst({
            where: {email: email, not: {id: userId}}
        })

        if(duplicate_email){
            return res.status(400).json({error: "another user with that email already exists"});
        }

        data.email = email;
    }
    if(birthday) data.birthday = birthday;
    if(req.file){
        const savePath = path.join(__dirname, "../uploads/avatars", req.file.originalname);
      fs.writeFileSync(savePath, req.file.buffer);
    }

    if(!data|| Object.keys(data).length === 0){
        return res.status(400).json({error: "empty payload"})
    }

    try{
        const user = await prisma.user.update({
            where: {id: req.auth.sub},
            data: data,
            select: {id: true, utorid:true, name:true, email:true, 
                    birthday:true, role:true, points:true,
                createdAt: true, lastLogin: true, verified: true, avatarUrl: true}
        });
        return res.json(user);

    }catch(err){
        return res.status(500).json({error: `error patching self ${err.message}`});
    }

});

router.get("/me", requireClearance(CLEARANCE.REGULAR), async(req, res) =>{
    // console.log({
    // body: req.body,
    // query: req.query,
    // params: req.params,
    // headers: req.headers,
    // method: req.method,
    // url: req.url
    // });

    try{
        const user = await prisma.user.findUnique({
            where: {id: req.auth.sub},
            select: {id: true, utorid:true, name:true, email:true, 
                    birthday:true, role:true, points:true,
                createdAt: true, lastLogin: true, verified: true, avatarUrl: true}
        });

        promotions = await getUsersValidPromotions(user);
        user.promotions = promotions
        return res.json(user);

    }catch(err){
        //console.log(`error getting self ${err.message}`);
        return res.status(500).json({error: `error getting self ${err.message}`});
    }
      
});

router.get("/:userId", requireClearance(CLEARANCE.CASHIER), async(req, res)=>{
    //console.log("get user", req.body);

    // build select depengind on users role
    var select = {}
    var userId = req.params.userId; 
    var userId = Number(userId);
    if(isNaN(userId)){
        return res.status(400).json({error: "Invalide user ID - must be a number"});
    }

    
    if(req.auth.role === 'cashier'){
        select.id = true;
        select.utorid = true;
        select.name = true;
        select.points = true;
        select.verified = true;
    }else{
        select.id = true;
        select.utorid = true;
        select.name = true;
        select.email = true;
        select.birthday = true;
        select.role = true;
        select.points = true;
        select.createdAt = true;
        select.lastLogin = true;
        select.verified = true;
        select.avatarUrl = true;
    }

    
    try{
        const user = await prisma.user.findUnique({
            where: {id: userId},
            select: select
        })
        if(!user){
            return res.status(404).json({error: "user not found"});
        }
        //need to handle getting promotions waiting on understanding promotions functionality
        user.promotions = await getUsersValidPromotions(user);

        return res.status(200).json(user);

    }catch(err){
        return res.status(500).json({error: `error getting user ${userId} -> ${err.message}`})
    }

});

const patchUserSchema = z.object({
    email: z.string().email("invalid email format").refine(val => val.endsWith("@mail.utoronto.ca"), {
        message: "Email must be of domain @mail.utoronto.ca"
    }).optional().nullable(),
    verified: z.literal(true).optional().nullable(),
    suspicious: z.boolean().optional().nullable(),
    role: z.enum(['regular', 'cashier', 'manager', 'superuser']).optional().nullable(),
});

router.patch("/:userId", requireClearance(CLEARANCE.MANAGER), validatePayload(patchUserSchema), async(req, res)=>{
    // console.log({
    // body: req.body,
    // query: req.query,
    // params: req.params,
    // headers: req.headers,
    // method: req.method,
    // url: req.url
    // });
    
    
    const {email, verified, suspicious, role} = req.body;
    var data = {};
    var select = {};
    var userId = req.params.userId; 
    var userId = Number(userId);

    if(isNaN(userId)){
        //console.log("in patch Invalid user ID - must be a number");
        return res.status(400).json({error: "Invalid user ID - must be a number"});
    }

    if(email){
        //check email still unique 
        const duplicate_email = await prisma.user.findFirst({
            where: {email: email, NOT: {id: userId}}
        });

        if(duplicate_email){
            //console.log("another user with that email already exists");
            return res.status(400).json({error: "another user with that email already exists"});
        }

        data.email = email;
        select.email = true;
    }
    if(verified){
        data.verified = verified;
        select.verified = true;
    }
    if (suspicious){
        data.suspicious = suspicious;
        select.suspicious = true;
    }
    if(role){
        //for manager can only update roles of cashier or regular
        if(req.auth.role === 'manager' && (role === 'manager' || role === 'superuser') ){  
            // console.log({
            // body: req.body,
            // query: req.query,
            // params: req.params,
            // headers: req.headers,
            // method: req.method,
            // url: req.url,
            // error: `manager not permitted to make role update for role - ${role}`})  
            return res.status(403).json({error: `manager not permitted to make role update for role - ${role}`});   
        }

        if(role === 'cashier'){
            const user = await prisma.user.findUnique({
                where: {id: userId},
                select: {suspicious: true}
            });

            if(user.suspicious){
                return res.status(400).json({error: "cannot promote a suspicious user"});
            }
        }
        
        data.role = role;
        select.role = true;
    }

    if(!data|| Object.keys(data).length === 0){
        return res.status(400).json({error: "empty payload"})
    }

    select.id = true;
    select.utorid = true;
    select.name = true;
    try{
        const user = await prisma.user.update({
            where: {id: userId}, 
            data: data,
            select: select
        })
        //console.log("user", user)
        return res.status(200).json(user);
    }catch(err){
        
        return res.status(500).json({error: `error updating user ${userId} -> ${err.message}`})
    }

});


const updateOwnPasswordSchema = z.object({
    old: z.string(),
    new: z.string().min(8, "Password must be at least 8 characters long")
  .max(20, "Password must be at most 20 characters long")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character")
});

router.patch("/me/password", requireClearance(CLEARANCE.REGULAR), validatePayload(updateOwnPasswordSchema), async(req, res)=> {
    //console.log("PATCH /me/password body:", req.body);
    
    const {old, new:newPassword} = req.body;

    try{
        const user = await prisma.user.findUnique({
            where: { id: req.auth.sub },
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const match = await bcrypt.compare(old, user.password);
        if (!match) {
            return res.status(403).json({ error: "Old password is incorrect" });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: { password: hashed },
        });

        return res.status(200).json({message: "Password updated successfully" });

    }catch(err){
        return res.status(500).json({error: `error updating password ${err.message}`});
    }
    

});

// Ariel's subrouter for /users/transactions
const userTransactionsRouter = require('./users_transactions');
router.use('/', userTransactionsRouter);

module.exports = router;