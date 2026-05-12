require("dotenv").config();

const { Client, GatewayIntentBits, AttachmentBuilder } = require("discord.js");
const puppeteer = require("puppeteer");
const fs = require("fs");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let interval = null;
let browser = null;
let page = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function log(channel, msg) {
    console.log("[LOG]", msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

// =======================
// BROWSER INIT
// =======================
async function getBrowser() {
    if (browser) {
        try {
            await browser.version();
            return browser;
        } catch {
            browser = null;
            page = null;
        }
    }

    console.log("[BROWSER] Lancement Chromium...");

    browser = await puppeteer.launch({
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-first-run",
            "--no-zygote",
            "--single-process",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-default-apps",
            "--mute-audio",
            "--no-default-browser-check"
        ]
    });

    page = await browser.newPage();

    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.setViewport({ width: 1280, height: 800 });

    browser.on("disconnected", () => {
        console.log("[BROWSER] Déconnecté, reset.");
        browser = null;
        page = null;
    });

    console.log("[BROWSER] Prêt.");
    return browser;
}

// =======================
// INJECTION COOKIES
// =======================
async function injectCookies() {
    const cookies = [
        {
            name: "PHPSESSID",
            value: process.env.COOKIE_PHPSESSID,
            domain: "minestrator.com",
            path: "/"
        },
        {
            name: "api-key",
            value: process.env.COOKIE_API_KEY,
            domain: "minestrator.com",
            path: "/"
        },
        {
            name: "auth-state",
            value: process.env.COOKIE_AUTH_STATE || "authenticated",
            domain: "minestrator.com",
            path: "/"
        },
        {
            name: "cw_conversation",
            value: process.env.COOKIE_CW,
            domain: "minestrator.com",
            path: "/"
        }
    ].filter(c => c.value); // ignore les cookies non définis

    await page.setCookie(...cookies);
    console.log("[COOKIES] Injectés :", cookies.map(c => c.name).join(", "));
}

// =======================
// ENVOYER SCREENSHOT
// =======================
async function sendScreenshot(channel, label = "screenshot") {
    try {
        if (!page) {
            await channel.send("❌ Aucune page ouverte.");
            return;
        }

        const path = `/tmp/${label}_${Date.now()}.png`;
        await page.screenshot({ path, fullPage: true });

        const attachment = new AttachmentBuilder(path, { name: `${label}.png` });
        await channel.send({
            content: `📸 **Screenshot** — ${page.url()}`,
            files: [attachment]
        });

        fs.unlinkSync(path);
    } catch (err) {
        await channel.send("❌ Erreur screenshot: " + err.message);
    }
}

// =======================
// RESTART SERVER
// =======================
async function restartServer(channel) {
    try {

        // Reset browser à chaque restart
        if (browser) {
            try { await browser.close(); } catch {}
            browser = null;
            page = null;
        }

        await getBrowser();

        // ---- INJECTION COOKIES (bypass login) ----
        await log(channel, "🍪 Injection des cookies...");

        // On doit d'abord visiter le domaine avant d'injecter les cookies
        await page.goto("https://minestrator.com", {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await injectCookies();

        // ---- PAGE SERVEUR ----
        await log(channel, "🎮 Accès au panneau serveur...");

        await page.goto(process.env.SERVER_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await sleep(5000);

        // Screenshot pour vérifier qu'on est bien connecté
        await sendScreenshot(channel, "panel");

        // Vérifie qu'on est connecté (pas redirigé vers login)
        const currentUrl = page.url();
        if (currentUrl.includes("/login")) {
            await log(channel, "❌ Cookies expirés — reconnecte-toi sur le site et mets à jour les cookies dans le .env");
            return;
        }

        await log(channel, "✅ Connecté ! Recherche du bouton restart...");

        // Debug : liste tous les boutons trouvés
        const allButtons = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
            return buttons.map(el => el.innerText?.trim()).filter(t => t.length > 0);
        });
        await log(channel, "🔎 Boutons: " + allButtons.slice(0, 20).join(" | "));

        // Cherche le bouton restart
        const restartBtn = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
            return buttons.find(el => {
                const text = el.innerText?.toLowerCase() || "";
                return (
                    text.includes("redémarrer") ||
                    text.includes("redemarrer") ||
                    text.includes("restart") ||
                    text.includes("reboot") ||
                    text.includes("relancer")
                );
            }) || null;
        });

        const isFound = await page.evaluate(el => el !== null, restartBtn);

        if (!isFound) {
            await log(channel, "❌ Bouton restart introuvable.");
            await sendScreenshot(channel, "error_btn");
            return;
        }

        await restartBtn.click();
        await sleep(2000);

        // Confirmation éventuelle
        const confirmed = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
            const confirmBtn = buttons.find(el => {
                const text = el.innerText?.toLowerCase() || "";
                return (
                    text.includes("confirmer") ||
                    text.includes("confirm") ||
                    text.includes("oui") ||
                    text.includes("yes") ||
                    text.includes("ok")
                );
            });
            if (confirmBtn) {
                confirmBtn.click();
                return true;
            }
            return false;
        });

        await sleep(2000);
        await sendScreenshot(channel, "after_restart");

        if (confirmed) {
            await log(channel, "🎉 RESTART CONFIRMÉ ET LANCÉ !");
        } else {
            await log(channel, "🎉 RESTART LANCÉ !");
        }

    } catch (err) {
        console.error("[ERREUR]", err);
        await log(channel, "❌ ERREUR: " + err.message);

        if (browser) {
            try { await browser.close(); } catch {}
            browser = null;
            page = null;
        }
    }
}

// =======================
// STOP SYSTEM
// =======================
async function stopSystem(channel) {
    clearInterval(interval);
    interval = null;

    if (browser) {
        try { await browser.close(); } catch {}
        browser = null;
        page = null;
    }

    await log(channel, "🛑 Système arrêté proprement.");
}

// =======================
// DISCORD BOT
// =======================
client.once("ready", () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const channel = message.channel;

    // !start
    if (message.content === "!start") {
        if (interval) return message.reply("⚠️ Le système est déjà actif !");
        await message.reply("🚀 Système activé ! Premier restart en cours...");
        await restartServer(channel);
        interval = setInterval(async () => {
            await log(channel, "⏱️ Restart automatique toutes les 3h...");
            await restartServer(channel);
        }, 3 * 60 * 60 * 1000);
    }

    // !stop
    if (message.content === "!stop") {
        await stopSystem(channel);
        await message.reply("🛑 Système arrêté.");
    }

    // !restart
    if (message.content === "!restart") {
        await message.reply("🔄 Restart manuel en cours...");
        await restartServer(channel);
    }

    // !status
    if (message.content === "!status") {
        if (interval) {
            await message.reply("✅ Système **actif** — restart auto toutes les 3h.");
        } else {
            await message.reply("🔴 Système **inactif** — tape `!start` pour démarrer.");
        }
    }

    // !screenshot
    if (message.content === "!screenshot") {
        if (!page) return message.reply("❌ Aucune page ouverte. Lance `!start` d'abord.");
        await message.reply("📸 Screenshot en cours...");
        await sendScreenshot(channel, "manual");
    }

    // !goto <url>
    if (message.content.startsWith("!goto ")) {
        const url = message.content.replace("!goto ", "").trim();
        if (!page) return message.reply("❌ Aucune page ouverte. Lance `!start` d'abord.");
        await message.reply(`🌐 Navigation vers ${url}...`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await sleep(3000);
        await sendScreenshot(channel, "goto");
    }
});

client.login(process.env.DISCORD_TOKEN);
