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
let bearerToken = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function log(channel, msg) {
    console.log("[LOG]", msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

// =======================
// SCREENSHOT → DISCORD
// =======================
async function sendScreenshot(channel, label = "screenshot") {
    try {
        if (!page) return;
        const path = `/tmp/${label}_${Date.now()}.png`;
        await page.screenshot({ path, fullPage: false });
        const attachment = new AttachmentBuilder(path, { name: `${label}.png` });
        await channel.send({ content: `📸 ${page.url()}`, files: [attachment] });
        fs.unlinkSync(path);
    } catch (err) {
        console.error("[SCREENSHOT ERROR]", err.message);
    }
}

// =======================
// BROWSER
// =======================
async function getBrowser() {
    if (browser) {
        try { await browser.version(); return browser; }
        catch { browser = null; page = null; bearerToken = null; }
    }

    console.log("[BROWSER] Lancement...");

    browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-first-run",
            "--no-zygote",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-default-apps",
            "--mute-audio"
        ]
    });

    page = await browser.newPage();

    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1280, height: 800 });

    // Bloque images/fonts pour économiser RAM
    await page.setRequestInterception(true);
    page.on("request", req => {
        if (["image", "font", "media"].includes(req.resourceType())) {
            req.abort();
        } else {
            // Capture le Bearer token au passage
            const auth = req.headers()["authorization"];
            if (auth && auth.startsWith("Bearer ")) {
                bearerToken = auth.replace("Bearer ", "");
                console.log("[TOKEN] Capturé !");
            }
            req.continue();
        }
    });

    browser.on("disconnected", () => {
        console.log("[BROWSER] Déconnecté.");
        browser = null; page = null; bearerToken = null;
    });

    console.log("[BROWSER] Prêt.");
    return browser;
}

// =======================
// LOGIN
// =======================
async function login(channel) {
    try {
        await log(channel, "🔐 Login MineStrator...");

        await page.goto("https://minestrator.com/login", {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await sleep(2000);
        await page.waitForSelector("input", { timeout: 15000 });

        const inputs = await page.$$("input");
        if (inputs.length < 2) {
            await log(channel, "❌ Champs login introuvables");
            await sendScreenshot(channel, "error_login");
            return false;
        }

        await inputs[0].click({ clickCount: 3 });
        await inputs[0].type(process.env.MINESTRATOR_EMAIL, { delay: 50 });
        await inputs[1].click({ clickCount: 3 });
        await inputs[1].type(process.env.MINESTRATOR_PASSWORD, { delay: 50 });
        await page.keyboard.press("Enter");

        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await sleep(3000);

        if (page.url().includes("/login")) {
            await log(channel, "❌ Login échoué");
            await sendScreenshot(channel, "error_auth");
            return false;
        }

        await log(channel, "✅ Connecté !");
        return true;

    } catch (err) {
        await log(channel, "❌ Erreur login: " + err.message);
        return false;
    }
}

// =======================
// RESTART
// =======================
async function restartServer(channel) {
    try {

        // Reset browser à chaque restart
        if (browser) {
            try { await browser.close(); } catch {}
            browser = null; page = null; bearerToken = null;
        }

        await getBrowser();

        // Login
        const ok = await login(channel);
        if (!ok) return;

        // Va sur la page serveur
        const serverId = (process.env.SERVER_URL || "").split("/").filter(Boolean).pop();
        await log(channel, "🎮 Accès panneau serveur...");

        await page.goto(`https://minestrator.com/my/server/${serverId}`, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await sleep(5000);
        await sendScreenshot(channel, "panel");

        // Attend que le token soit capturé
        if (!bearerToken) {
            await log(channel, "⏳ Attente token...");
            await sleep(5000);
        }

        if (!bearerToken) {
            await log(channel, "❌ Token non capturé");
            await sendScreenshot(channel, "error_token");
            return;
        }

        await log(channel, "🔑 Token capturé ! Envoi restart...");

        // Ferme le browser pour libérer RAM
        try { await browser.close(); } catch {}
        browser = null; page = null;

        // Envoie la commande restart via API
        const res = await fetch(`https://mine.sttr.io/server/${serverId}/poweraction`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${bearerToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Origin": "https://minestrator.com",
                "Referer": "https://minestrator.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            body: JSON.stringify({ poweraction: "restart" })
        });

        console.log("[RESTART] Status:", res.status);

        if (res.status === 200 || res.status === 201 || res.status === 204) {
            await log(channel, "🎉 RESTART LANCÉ !");
        } else {
            const body = await res.text().catch(() => "");
            await log(channel, `❌ Échec restart HTTP ${res.status} — ${body.slice(0, 100)}`);
        }

    } catch (err) {
        console.error("[ERREUR]", err);
        await log(channel, "❌ ERREUR: " + err.message);
        if (browser) { try { await browser.close(); } catch {} browser = null; page = null; }
    }
}

// =======================
// STOP
// =======================
async function stopSystem(channel) {
    clearInterval(interval);
    interval = null;
    bearerToken = null;
    if (browser) { try { await browser.close(); } catch {} browser = null; page = null; }
    await log(channel, "🛑 Système arrêté.");
}

// =======================
// DISCORD
// =======================
client.once("ready", () => console.log(`✅ Bot connecté : ${client.user.tag}`));

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const channel = message.channel;

    if (message.content === "!start") {
        if (interval) return message.reply("⚠️ Déjà actif !");
        await message.reply("🚀 Activation...");
        await restartServer(channel);
        interval = setInterval(async () => {
            await log(channel, "⏱️ Restart auto 3h...");
            await restartServer(channel);
        }, 3 * 60 * 60 * 1000);
    }

    if (message.content === "!stop") {
        await stopSystem(channel);
        await message.reply("🛑 Arrêté.");
    }

    if (message.content === "!restart") {
        await message.reply("🔄 Restart...");
        await restartServer(channel);
    }

    if (message.content === "!status") {
        await message.reply(interval
            ? "✅ **Actif** — restart auto toutes les 3h."
            : "🔴 **Inactif** — tape `!start`.");
    }

    if (message.content === "!screenshot") {
        if (!page) return message.reply("❌ Aucune page ouverte.");
        await sendScreenshot(channel, "manual");
    }
});

client.login(process.env.DISCORD_TOKEN);
