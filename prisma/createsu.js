/*
 * Complete this script so that it is able to add a superuser to the database
 * Usage example: 
 *   node prisma/createsu.js clive123 clive.su@mail.utoronto.ca SuperUser123!
 */
'use strict';
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const createSuperUserSchema = z.object({
  utorid: z.string().regex(/^[a-zA-Z0-9]+$/, {
    message: "Value must be alphanumeric",
    })
    .min(7, "utorid must be at least 7 characters long")
    .max(8, "utorid too long"),
  email: z.string()
    .email("Invalid email format")
    .refine(val => val.endsWith("@mail.utoronto.ca"), {
      message: "Email must be of domain @mail.utoronto.ca"
    }),
  password: z.string()
    .min(8, "Password must be at least 8 characters long")
    .max(20, "Password must be at most 20 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
});

(async function () {
    const args = process.argv;
    if (args.length !== 5) {
        console.error("Usage: node prisma/createsu.js <utorid> <email> <password>");
        process.exit(1);
    }

    let data = {
        utorid: args[2],
        email: args[3],
        password: args[4],
    };

    try {
        data = createSuperUserSchema.parse(data);
    } catch (err) {
        const errors = err.errors.map(e => `${e.path.join('.')} - ${e.message}`);
        console.error(`Validation error(s):\n${errors.join('\n')}`);
        process.exit(1);
    }

    
    const hashedPassword = await bcrypt.hash(data.password, 10);

    //check user utorid and email for uniqueness
    const existing_user = await prisma.user.findFirst({
            where: {
                OR: [{email: data.email}, {utorid: data.utorid}]
            }
    });

    if(existing_user){
            const duplicatedField = existing_user.utorid === data.utorid  ? "utorid" : 'email';
            console.error(`${duplicatedField} already exists`);
            process.exit(1);
    }

    try {
        const user = await prisma.user.create({
        data: {
            utorid: data.utorid,
            email: data.email,
            password: hashedPassword,
            verified: true,
            role: 'superuser'
        },
        });
        console.log(`Superuser created: ${user.email}`);
    } catch (err) {
        console.error(`Error creating superuser: ${err.message}`);
    }
})();
