// The stand-in bot. Fictional: no such bot exists, and the token only ever reaches fake-api.mjs on this machine.
export const BOT = { account: "noreon_e2e", id: 9900001, username: "noreon_e2e_bot", token: "9900001:e2e_not_a_real_token_0123456789abcdef", secret: "e2e_webhook_secret_not_real_0123456789" };
export const CRON_SECRET = "e2e-cron-secret-not-real";
export const FAKE_REPLY = { hy: "Զոյի փորձնական պատասխանը։", en: "Zoe's test answer.", ru: "Тестовый ответ Zoe." };
export const chatOf = (n) => 880000000 + n;
export const telegramPeople = {
  tgLink: [31, "37499000231", "hy"], tgAnswer: [32, "37499000232", "hy"], tgUrgent: [33, "37499000233", "hy"], tgModel: [34, "37499000234", "en"],
  tgTakeover: [35, "37499000235", "hy"], tgDose: [36, "37499000236", "en"], tgConsent: [37, "37499000237", "hy"], tgInject: [38, "37499000238", "en"], tgFail: [39, "37499000239", "en"], tgAction: [40, "37499000240", "en"],
  tgAdmin: [41],
  tgBp: [50, "37499000250", "en"], tgBpHy: [51, "37499000251", "hy"], tgBpWeek: [52, "37499000252", "en"], tgBpRace: [53, "37499000253", "en"], tgBpStale: [54, "37499000254", "en"],
  tgResultsHy: [55, "37499000255", "hy"], tgResultsEn: [56, "37499000256", "en"], tgPlanHy: [57, "37499000257", "hy"], tgSweeps: [58, "37499000258", "en"],
  tgLdlHy: [59, "37499000259", "hy"], tgLdlEn: [60, "37499000260", "en"], tgMenuHy: [61, "37499000261", "hy"], tgMenuEn: [62, "37499000262", "en"],
  tgMediaHy: [63, "37499000263", "hy"], tgMediaEn: [64, "37499000264", "en"], tgDoseRace: [65, "37499000265", "en"], tgDoseElse: [66, "37499000266", "en"],
  tgLong: [67, "37499000267", "en"], tgQuick: [68, "37499000268", "en"], tgDoseBig: [69, "37499000269", "hy"], tgRelink: [70, "37499000270", "en"], tgRate: [71, "37499000271", "en"],
  tgExpire: [72, "37499000272", "en"], tgPlanBig: [73, "37499000273", "en"], tgResultsBig: [74, "37499000274", "en"], tgUrgentBp: [75, "37499000275", "en"], tgBpWords: [76, "37499000276", "en"], tgLogWords: [77, "37499000277", "en"],
};
