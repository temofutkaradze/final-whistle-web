// Everything the public pages say about the product lives here. The brand name is defined once (NAME):
// change it here and the header, footer, landing page, page titles and the Telegram test message follow.
// To launch another topic (another sport, films, crypto...) change the texts below and the example images in
// public/examples; the layout, colours and components stay the same.

const NAME = "Final Whistle";

export const SITE = {
  name: NAME,
  description: "Result images for Instagram pages, generated automatically and delivered to your Telegram.",

  // Header and footer links on the landing page (ids of the sections in src/app/page.tsx).
  nav: [
    { label: "How it works", href: "#how" },
    { label: "Templates", href: "#templates" },
    { label: "Features", href: "#features" },
    { label: "FAQ", href: "#faq" },
  ],

  hero: {
    eyebrow: "Football result posts for Instagram",
    headline: ["The match is over.", "The post is ready."],
    intro: `When a match you picked ends, ${NAME} sends a finished result image to your Telegram chat: the score, the scorers and your page name, at 1080×1350.`,
    fineprint: "You publish to Instagram yourself. Free demo build for testing.",
    more: "How it works",
  },

  examples: [
    { src: "/examples/post-juve-inter.jpg", alt: "Example result post: Juventus 1-1 Inter" },
    { src: "/examples/post-bayern-dortmund.jpg", alt: "Example result post: Bayern Munich 4-0 Dortmund" },
    { src: "/examples/post-psg-marseille.jpg", alt: "Example result post: Paris Saint Germain 2-0 Marseille" },
  ],

  // Small illustration of the message that arrives in Telegram (not a real chat).
  mockup: {
    label: "Illustration of a Telegram message",
    bot: "@YourPageBot",
    status: "FT",
    file: "Juventus 1-1 Inter.jpg",
    meta: "1080×1350 JPEG file",
    caption: "Juventus 1-1 Inter",
    note: "Arrives shortly after full time",
  },

  coverageLabel: "Competitions",

  steps: {
    title: "Three steps, then it runs itself.",
    lead: "Connect your Telegram bot once and choose your matches. When a match ends, the post lands in your chat.",
    items: [
      {
        title: "Connect your Telegram bot",
        text: "Create a bot with @BotFather in Telegram and paste its token into the dashboard. The bot and the chat stay yours.",
        tag: "Your own bot",
      },
      {
        title: "Pick your matches",
        text: "Choose the leagues and clubs you follow, then send /matches in Telegram and tap the games you want a post for. You can also send a photo to use as the background.",
        tag: "In Telegram",
      },
      {
        title: "Get the post",
        text: "Shortly after a selected match is marked as finished, the image arrives in your chat as a file, ready to download and publish.",
        tag: "Ready to publish",
      },
    ],
  },

  templates: {
    title: "Four ready-made styles. Or make your own.",
    lead: "Pick a built-in style, build your own with a few options, or paste your own HTML. Classic is shown from a real result image; the others are simple layout sketches.",
    realLabel: "Real result image",
    sketchLabel: "Layout sketch",
    layoutLabel: "Layout",
    items: [
      {
        key: "classic",
        name: "Classic",
        tagline: "Big score, scorers on both sides.",
        text: "A full-photo background with the score in the middle and the scorers listed on each side.",
        layout: "Score in the centre, scorers left and right",
        imgAlt: "Classic template: Bayern Munich 4-0 Dortmund",
      },
      {
        key: "frame",
        name: "Frame",
        tagline: "Thin frame, centred score.",
        text: "A thin white frame around a centred score, with the team names and the scorers underneath.",
        layout: "Thin frame, everything centred",
      },
      {
        key: "panel",
        name: "Panel",
        tagline: "Dark panel under the photo.",
        text: "A dark panel at the bottom holds the score, the teams and the scorers, in a condensed broadcast-style font.",
        layout: "Dark panel at the bottom",
      },
      {
        key: "stripe",
        name: "Stripe",
        tagline: "Band across the photo.",
        text: "A dark band across the middle of the photo holds the crests and the score, with the scorers below it.",
        layout: "Band across the middle",
      },
    ],
    own: "In the dashboard you can build your own template with options for layout, font, colours and background, or paste your own HTML. You can keep up to 12 of your own templates, and every template can show your page name or your logo.",
  },

  features: {
    title: "Made for Instagram pages.",
    lead: "Everything you need to turn a final score into a post.",
    items: [
      { metric: "1080 × 1350", label: "Instagram-ready size", text: "A 4:5 portrait image, the shape that fills the screen in the Instagram feed." },
      { metric: "JPEG file", label: "Sent as a file", text: "Telegram delivers it as a file instead of a photo, so the picture is not compressed." },
      { metric: "Automatic", label: "Scorers and cards", text: "Goals, penalties and cards are added from match data once the match is finished." },
      { metric: "Your brand", label: "Name or logo", text: "Show your page name or your own logo in the corner of every post." },
    ],
  },

  faqTitle: "Good to know.",
  faqLead: "Short answers about how it works.",
  faq: [
    {
      q: `Does ${NAME} post to Instagram for me?`,
      a: "No. It delivers the finished image to your Telegram chat. You download it and publish it yourself, so you stay in control of your page, your caption and your timing.",
    },
    {
      q: "Do I need my own Telegram bot?",
      a: "Yes. Create one with @BotFather in about a minute and paste its token into the dashboard. There is no shared bot: the bot and the chat stay yours, and the token is stored encrypted.",
    },
    {
      q: "Which matches get a post?",
      a: "The ones you pick. Send /matches in Telegram (or type a team name) and tap the games you want. The leagues and clubs you follow in the dashboard decide which matches appear in that list.",
    },
    {
      q: "When does the post arrive?",
      a: "Shortly after the match is marked as finished in the match data. That can take a few minutes after the final whistle.",
    },
    {
      q: "Which competitions are covered?",
      a: "The Premier League, La Liga, Serie A, Bundesliga, Ligue 1, the UEFA Champions League and the UEFA Nations League.",
    },
    {
      q: "Can I use my own design?",
      a: "Yes. Choose one of the four built-in styles, build your own template in the dashboard with a few options, or paste your own HTML. Every template can show your page name or your own logo.",
    },
    {
      q: "Is it free?",
      a: "This is a demo build for testing. It is free and no payment details are collected.",
    },
    {
      q: "Can I delete my data?",
      a: "Yes. Delete your account from the dashboard and your pages, saved bot token, selected matches, uploaded logo and background photos are removed.",
    },
  ],

  faqPrompt: {
    guestTitle: "Ready to start?",
    guestText: "Create an account, connect your bot and pick your first match.",
    userTitle: "Open your dashboard",
    userText: "Connect your bot and pick your matches.",
  },

  cta: {
    title: "Never design a result post again.",
    text: "Set up your bot once. After that the posts arrive in Telegram as your matches finish.",
    fineprint: "Free demo build for testing",
  },

  footer: {
    tagline: "Result images for football pages",
    meta: "Free demo build for testing",
  },
} as const;
