const { CLEARANCE, requireClearance, validatePayload } = require('./temp_middleware');
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
    confirm functionality of clearance 
    lastLogin check how it works\

    users endpoint remove 
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
        return res.status(201).json(user);

   }catch(err){
        return res.status(500).json({error: `error creating user ${err.message}`});
   }
    
});

const getUsersPayload = z.object({
    name: z.string().optional(),
    role: z.enum(['regular', 'cashier', 'manager', 'superuser']).optional(),
    verified: z.boolean().optional(),
    activated: z.boolean().optional(),
    page: z.number().optional(),
    limit: z.number().optional()

});

router.get("/", requireClearance(CLEARANCE.MANAGER), validatePayload(getUsersPayload), async(req, res)=> {

    //check which fields were included in request 
    const {name, role, verified, activated, page, limit} = req.body;
    const page_check = page|| 1;
    const take = limit || 10;
    const skip = (page_check - 1) * take;

    const where = {};

    if (name) where.name = name;
    if (role) where.role = role;
    if (verified) where.verified = verified;
    if (activated) where.lastLogin = { not: null };

    try{
        const users = await prisma.user.findMany({
            where, 
            skip, 
            take, 
            select: {id: true, utorid: true, name: true, email: true, 
                    birthday: true, role: true, points: true, createdAt: true, 
                    lastLogin: true, verified: true, avatarUrl: true}
        });
        return res.status(200).json({count: users.length, results: users});
    }catch(err){
        return res.status(500).json({error: `error getting users ${err.message}`});
    }

});

function getUsersValidPromotions(user){
    promotions = [];
    return promotions;
}

const multer = require("multer");
const path = require("path");
const upload = multer({ dest: path.join(__dirname, "uploads/avatars") });
const patchSelfPayload = z.object({
    name: z.string().min(1, "name too short").max(50, "name too long").optional(),
    email: z.string().email("invalid email format").refine(val => val.endsWith("@mail.utoronto.ca"), {
        message: "must be of domain @mail.utoronto.ca"
    }).optional(),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional()
});

router.patch("/me", upload.single("avatar"), reuquiredClearance(CLEARANCE.REGULAR), validatePayload(patchSelfPayload), async(req, res)=> {
    

    var data = {};
    const {name, email, birthday} = req.body;

    
    if(name) data.name = name;
    if(email){

        //check email still unique 
        const duplicate_email = await prisma.findFirst({
            where: {email: email, not: {id: userId}}
        })

        if(duplicate_email){
            res.status(400).json({error: "another user with that email already exists"});
        }

        data.email = email;
    }
    if(birthday) data.birthday = birthday;
    console.log(req.file)
    if(req.file) data.avatar = req.file.path;

    try{
        const user = await prisma.user.update({
            where: {id: req.user.sub},
            data: data,
            select: {id: true, utorid:true, name:true, email:true, 
                    birthday:true, role:true, points:true,
                createdAt: true, lastLogin: true, verified: true, avatarUrl: true}
        });
        res.json(user);

    }catch(err){
        res.status(500).json({error: `error patching self ${err.message}`});
    }

});

router.get("/:userId", reuquiredClearance(CLEARANCE.CASHIER), async(req, res)=>{
    

    // build select depengind on users role
    var select = {}
    var userId = req.params.userId; 
    var userId = Number(userId);
    if(isNaN(userId)){
        return res.status(400).json({error: "Invalide user ID - must be a number"});
    }

    
    if(req.user.role === 'cashier'){
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
        user.promotions = getUsersValidPromotions(user);

        return res.status(200).json(user);

    }catch(err){
        return res.status(500).json({error: `error getting user ${userId} -> ${err.message}`})
    }

});

const patchUserSchema = z.object({
    email: z.string().email("invalid email format").refine(val => val.endsWith("@mail.utoronto.ca"), {
        message: "Email must be of domain @mail.utoronto.ca"
    }).optional(),
    verified: z.literal(true).optional(),
    suspicious: z.boolean().optional(),
    role: z.enum(['regular', 'cashier', 'manager', 'superuser']).optional(),
});

router.patch("/:userId", reuquiredClearance(CLEARANCE.MANAGER), validatePayload(patchUserSchema), async(req, res)=>{
    
    
    const {email, verified, suspicious, role} = req.body;
    var data = {};
    var select = {};
    var userId = req.params.userId; 
    var userId = Number(userId);

    if(isNaN(userId)){
        return res.status(400).json({error: "Invalide user ID - must be a number"});
    }

    if(email){
        //check email still unique 
        const duplicate_email = await prisma.user.findFirst({
            where: {email: email, NOT: {id: userId}}
        });

        if(duplicate_email){
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
        if(req.user.role === 'manager' && (role !== 'cashier' || role !== 'regular') ){
            return res.status(403).json({error: `manager not permitted to make role update for role - ${role}`});   
        }
        
        data.role = role;
        select.role = true;
    }

    try{
        const user = await prisma.user.update({
            where: {id: userId}, 
            data: data,
            select: select
        })
        return res.status(200).json(user);
    }catch(err){
        return res.status(500).json({error: `error updating user ${userId} -> ${err.message}`})
    }

});


// router.get("/me", requireClearance(CLEARANCE.REGULAR), async(req, res) =>{
//     try{
//         const user = await prisma.findUnique({
//             where: {id: req.user.sub},
//             data: data,
//             select: {id: true, utorid:true, name:true, email:true, 
//                     birthday:true, role:true, points:true,
//                 createdAt: true, lastLogin: true, verified: true, avatarUrl: true}
//         });

//         promotions = getUsersValidPromotions(user);
//         user.promotions = promotions
//         res.json(user);

//     }catch(err){
//         res.status(500).json({error: `error patching self ${err.message}`});
//     }
      
// });

// const updateOwnPasswordSchema = z.object({
//     old: z.string(),
//     new: z.string().min(8, "Password must be at least 8 characters long")
//   .max(20, "Password must be at most 20 characters long")
//   .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
//   .regex(/[a-z]/, "Password must contain at least one lowercase letter")
//   .regex(/[0-9]/, "Password must contain at least one number")
//   .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character")
// });

// router.patch("/me/password", reuquiredClearance(CLEARANCE.REGULAR), validatePayload(updateOwnPasswordSchema), async(req, res)=> {
//     const {old, new:newPassword} = req.body;

//     try{
//         const user = await prisma.user.findUnique({
//             where: { id: req.user.sub },
//         });

//         if (!user) {
//             return res.status(404).json({ error: "User not found" });
//         }

//         const match = await bcrypt.compare(old, user.password);
//         if (!match) {
//             return res.status(403).json({ error: "Old password is incorrect" });
//         }

//         const hashed = await bcrypt.hash(newPassword, 10);
//         const updatedUser = await prisma.user.update({
//             where: { id: user.id },
//             data: { password: hashed },
//         });

//         res.status(200).json({ message: "Password updated successfully" });

//     }catch(err){
//         res.status(500).json({error: `error updating password ${err.message}`});
//     }
    

// });

module.exports = router;