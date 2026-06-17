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

const platformContents = [
  {
    pageKey: "terms",
    title: "Terms of Service",
    body:
      "These MVP terms explain the early Vibehall rules in plain language. Use the platform respectfully, do not abuse rooms or other members, and understand that the service is still evolving before a full public launch."
  },
  {
    pageKey: "privacy",
    title: "Privacy Policy",
    body:
      "This MVP privacy note explains that Vibehall stores account, room, chat, report, and moderation data needed to run the platform. A fuller legal policy should replace this draft before a broader public launch."
  },
  {
    pageKey: "community-guidelines",
    title: "Community Guidelines",
    body:
      "Vibehall is built for shared watching, live chat, and respectful room behavior. Harassment, hate, spam, impersonation, harmful content, and room disruption are not welcome."
  },
  {
    pageKey: "support",
    title: "Support",
    body:
      "Need help with Vibehall during the MVP stage? Contact the platform operator with the account, room, or report context that explains what happened."
  }
];

async function main() {
  for (const category of categories) {
    await prisma.category.upsert({
      create: category,
      update: category,
      where: { slug: category.slug }
    });
  }

  for (const content of platformContents) {
    await prisma.platformContent.upsert({
      create: {
        draftBody: content.body,
        draftUpdatedAt: new Date(),
        pageKey: content.pageKey,
        publishedAt: new Date(),
        publishedBody: content.body,
        publishedTitle: content.title,
        status: "published",
        title: content.title
      },
      update: {},
      where: { pageKey: content.pageKey }
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
