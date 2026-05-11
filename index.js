require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const puppeteer = require("puppeteer");

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
    console.log(msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

// =======================
// SAFE BROWSER INIT
// =======================
async function getBrowser(channel) {

    if (browser) return browser;

    await log(channel, "🔄 Lancement navigateur (Render safe)...");

    browser = await puppeteer.launch({
        headless: false, // 👈 visible
        slowMo: 40,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled"
        ]
    });

    page = await browser.newPage();

    page.setDefaultTimeout(60000);

    return browser;
}

// =======================
// LOGIN + NAV
// =======================
async function restartServer(channel) {

    try {

        await getBrowser(channel);

        // ======================
        // LOGIN
        // ======================

        await log(channel, "🌐 Login MineStrator...");

        await page.goto("https://minestrator.com/login", {
            waitUntil: "domcontentloaded"
        });

        await sleep(6000);

        const inputs = await page.$$("input");

        if (inputs.length < 2) {
            await log(channel, "❌ Login introuvable");
            await page.screenshot({ path: "login_error.png" });
            return;
        }

        await inputs[0].type(process.env.MINESTRATOR_EMAIL, { delay: 50 });
        await inputs[1].type(process.env.MINESTRATOR_PASSWORD, { delay: 50 });

        await log(channel, "➡️ Connexion...");

        await page.keyboard.press("Enter");

        await sleep(10000);

        // ======================
        // SERVER PAGE
        // ======================

        await log(channel, "🎮 Accès serveur...");

        await page.goto(process.env.SERVER_URL, {
            waitUntil: "networkidle2"
        });

        await sleep(8000);

        await page.screenshot({ path: "server.png", fullPage: true });

        // ======================
        // FIND RESTART BUTTON
        // ======================

        await log(channel, "🔍 Recherche bouton Redémarrer...");

        const buttons = await page.$$("button");

        let restartBtn = null;

        for (const btn of buttons) {

            const text = await page.evaluate(el => el.innerText.toLowerCase(), btn);
            const html = await page.evaluate(el => el.innerHTML.toLowerCase(), btn);

            if (
                text.includes("redémarrer") ||
                text.includes("redemarrer") ||
                text.includes("restart") ||
                html.includes("restart-alt")
            ) {
                restartBtn = btn;
                break;
            }
        }

        if (!restartBtn) {
            await log(channel, "❌ Bouton Redémarrer introuvable");
            await page.screenshot({ path: "restart_fail.png" });
            return;
        }

        await log(channel, "⚡ Clic restart...");

        await restartBtn.click();

        await sleep(3000);

        // confirmation popup
        const confirm = await page.$$("button");

        if (confirm[1]) {
            try {
                await confirm[1].click();
                await log(channel, "✅ Confirmation OK");
            } catch {}
        }

        await log(channel, "🎉 SERVEUR RESTARTÉ");

    } catch (err) {

        console.error(err);

        await log(channel, "❌ ERREUR: " + err.message);

        if (page) {
            await page.screenshot({ path: "error.png" });
        }

        // reset browser si crash
        try {
            if (browser) await browser.close();
        } catch {}

        browser = null;
        page = null;
    }
}

// =======================
// STOP SYSTEM
// =======================
async function stopSystem(channel) {

    await log(channel, "🛑 Arrêt système...");

    clearInterval(interval);
    interval = null;

    if (browser) {
        await browser.close();
        browser = null;
        page = null;
    }

    await log(channel, "🧹 Navigateur fermé");
}

// =======================
// DISCORD BOT
// =======================
client.once("ready", () => {
    console.log(`Bot connecté : ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {

    if (message.author.bot) return;

    const channel = message.channel;

    if (message.content === "!start") {

        if (interval) return message.reply("⚠️ Déjà actif");

        await log(channel, "🚀 SYSTEME ACTIVÉ (RENDER MODE)");

        await restartServer(channel);

        interval = setInterval(async () => {

            await log(channel, "⏱️ Restart auto (3h)");

            await restartServer(channel);

        }, 3 * 60 * 60 * 1000); // 👈 3 HEURES

        message.reply("✅ Auto-restart activé (3h)");

    }

    if (message.content === "!stop") {

        await stopSystem(channel);
        message.reply("🛑 arrêté");
    }
});

client.login(process.env.DISCORD_TOKEN);