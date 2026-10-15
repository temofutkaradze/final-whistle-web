// Everything the public pages say about the product lives here. To launch another topic
// (another sport, films, crypto...) change the texts below and the example images in public/examples;
// the layout, colours and components stay the same.

export const SITE = {
  name: "Final Whistle",
  description: "Result posts for social media, generated automatically and delivered to your Telegram.",
  eyebrow: "Football result posts for Instagram",
  headline: ["The match is over.", "The post is ready."],
  intro:
    "When the final whistle blows, Final Whistle sends a finished result image to your Telegram: scores, scorers and your page name, at 1080×1350.",
  fineprint: "You publish to Instagram yourself. Demo build for testing, no payments yet.",
  examples: [
    { src: "/examples/post-juve-inter.jpg", alt: "Example result post: Juventus 1-1 Inter" },
    { src: "/examples/post-bayern-dortmund.jpg", alt: "Example result post: Bayern Munich 4-0 Dortmund" },
    { src: "/examples/post-psg-marseille.jpg", alt: "Example result post: Paris Saint Germain 2-0 Marseille" },
  ],
  stepsTitle: "Three steps, then it runs itself.",
  steps: [
    { title: "Connect your bot", text: "Create a Telegram bot with @BotFather and paste its token. Posts arrive in your own chat." },
    { title: "Choose your matches", text: "Pick the leagues and clubs you follow, then select the matches you want a post for." },
    { title: "Get the post", text: "When the match ends, the finished image with scores and scorers lands in Telegram, ready to publish." },
  ],
  templates: {
    eyebrow: "Templates",
    title: "Your page name. Your template.",
    text: "Every post carries the name of your page. Start with the built-in template; adding templates of your own is on the way.",
  },
  faqTitle: "Good to know.",
  faq: [
    { q: "Does Final Whistle post to Instagram for me?", a: "No. It delivers the finished image to your Telegram chat. You download it and publish it yourself, so you stay in control of your page." },
    { q: "Do I need a Telegram bot?", a: "Yes, your own. Create one with @BotFather in about a minute and paste its token into the dashboard. The bot and the chat stay yours." },
    { q: "When does the post arrive?", a: "Shortly after the match is confirmed as finished." },
    { q: "Can I use my own design?", a: "Posts use the built-in Classic template with your page name. Adding your own templates is planned." },
    { q: "Can I delete my data?", a: "Yes. Delete your account from the dashboard and your pages, saved bot token and selected matches are removed." },
  ],
  cta: "Never design a result post again.",
} as const;
