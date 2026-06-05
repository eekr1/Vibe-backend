import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { name: "Comedy", slug: "comedy", sortOrder: 10 },
  { name: "Music", slug: "music", sortOrder: 20 },
  { name: "Documentary", slug: "documentary", sortOrder: 30 },
  { name: "Podcast", slug: "podcast", sortOrder: 40 },
  { name: "Gaming", slug: "gaming", sortOrder: 50 },
  { name: "Horror / Mystery", slug: "horror-mystery", sortOrder: 60 },
  { name: "Commentary", slug: "commentary", sortOrder: 70 },
  { name: "Other", slug: "other", sortOrder: 80 }
];

async function main() {
  for (const category of categories) {
    await prisma.category.upsert({
      create: category,
      update: category,
      where: { slug: category.slug }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
