const { CLEARANCE, requireClearance, validatePayload } = require('./temp_middleware');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient} = require('@prisma/client');

const prisma = new PrismaClient();

const express = require("express");
const router = express.Router();


const createUsersPayload = {
    utorid: {type:'string', required: true}, 
    name: {type: 'string', required: true},
    email: {type: 'string', required: true}
}

router.post("/users", requireClearance(CLEARANCE.CASHIER), validatePayload(createUsersPayload), async (req, res) => {
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
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7).toDateString(); //7 days 
        const user = await prisma.user.create({
            data: {utorid, name, email, expiresAt, resetToken},
            select: {id: true, utorid: true, name: true, email: true, verified: true, expiresAt:true, resetToken:true}
        });
        res.status(201).json(user);

   }catch(err){
        res.status(500).json({error: `error creating user ${err}`});
   }
    
});

const getUsersPayload = {
    name: {type: 'string', required: false},
    role: {type: 'string', required: false},
    verified: {type: 'boolean', required: false},
    activated: {type: 'boolean', required: false},
    page: {type: 'int', required: false}

}

router.get("/users", requireClearance(CLEARANCE.MANAGER), async(req, res)=> {

    //check which fields were included in request 
    const {name, role, verified, activated, page, limit} = req.body;

    where = {};

    if(name){
        if(typeof name == "string"){

        }
        else{

        }
    }


})



module.exports = router;