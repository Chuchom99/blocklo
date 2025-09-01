// import { PrismaClient } from '@prisma/client';

// let prisma;

// if (process.env.NODE_ENV === 'production') {
//   prisma = new PrismaClient();
// } else {
//   // Avoid creating multiple instances during development (hot-reload)
//   if (!global.prisma) {
//     global.prisma = new PrismaClient();
//   }
//   prisma = global.prisma;
// }

// export default prisma;


// import pkg from '@prisma/client';
// const { PrismaClient } = pkg;

// let prisma;

// if (process.env.NODE_ENV === 'production') {
//   prisma = new PrismaClient({
//     log: ['query', 'info', 'warn', 'error']
//   });
// } else {
//   if (!global.prisma) {
//     global.prisma = new PrismaClient({
//       log: ['query', 'info', 'warn', 'error']
//     });
//   }
//   prisma = global.prisma;
// }

// // Test DB connection
// (async () => {
//   try {
//     await prisma.$connect();
//     console.log('[DB] Database connection successful');
//   } catch (err) {
//     console.error('[DB] Database connection failed:', err);
//   }
// })();

// export default prisma;


import pkg from '@prisma/client';
const { PrismaClient } = pkg;

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }
  prisma = global.prisma;
}

// Test DB connection
(async () => {
  try {
    console.log('Attempting to connect with DATABASE_URL:', process.env.DATABASE_URL);
    // console.log('DIRECT_URL:', process.env.DIRECT_URL);
    await prisma.$connect();
    console.log('[DB] Database connection successful');
  } catch (err) {
    console.error('[DB] Database connection failed:', err);
  }
})();

export default prisma;