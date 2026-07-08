// import "dotenv/config";
// import { PrismaPg } from "@prisma/adapter-pg";
// import { PrismaClient } from "./src/generated/prisma/client";
// import { generateAdminId } from "./src/utils/generate-id";

// const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
// const prisma = new PrismaClient({ adapter });

// const admin = await prisma.adminUser.create({
//   data: {
//     email: "faisal@millennia21.id",
//     full_name: "Faisal",
//     role: "SUPER_ADMIN",
//     is_active: true,
//   },
// });

// console.log(JSON.stringify({
//   ...admin,
//   admin_no: generateAdminId(admin.admin_no),
// }, null, 2));

// await prisma.$disconnect();
