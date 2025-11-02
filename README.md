# csc309-A2
- npm i
- node --watch index.js 3000
- npx prisma migrate reset --force -> reset data
- npx prisma studio -> view data
- npx prisma generate -> generate schema
- npx prisma db push -> no migration history
- npx prisma migrate dev -> updates migration history

node prisma/createsu.js catsis12 cats@mail.com pudding
node prisma/createuser.js catsis00 cats@mail.com pudding regular

Auth
1. node prisma/createsu.js catsis12 cats@mail.com pudding
2. http://localhost:3000/auth/tokens
```
{
  "utorid": "catsis12",
  "password": "puddingiscute"
}
```
3. Save token and add to header
    Key: Authorization
    Value: Bearer `token`
4. req.auth has fields
```
sub: user id
role: user role
iat: last issued
exp: expiration
```