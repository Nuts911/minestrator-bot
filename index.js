process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true";

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
// BROWSER INIT
// =======================
async function getBrowser() {

    if (browser) return browser;

    browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--single-process"
        ]
    });

    page = await browser.newPage();

    return browser;
}

// =======================
// RESTART SERVER
// =======================
async function restartServer(channel) {

    try {

        await getBrowser();

        await log(channel, "🌐 Connexion MineStrator...");

        await page.goto("https://minestrator.com/login", {
            waitUntil: "domcontentloaded"
        });

        await sleep(6000);

        const inputs = await page.$$("input");

        if (inputs.length < 2) {
            await log(channel, "❌ Login introuvable");
            return;
        }

        await inputs[0].type(process.env.MINESTRATOR_EMAIL, { delay: 50 });
        await inputs[1].type(process.env.MINESTRATOR_PASSWORD, { delay: 50 });

        await page.keyboard.press("Enter");

        await sleep(10000);

        await log(channel, "🎮 Accès serveur...");

        await page.goto(process.env.SERVER_URL, {
            waitUntil: "networkidle2"
        });

        await sleep(8000);

        await log(channel, "🔍 Recherche bouton restart...");

        const buttons = await page.$$("button");

        let restartBtn = null;

        for (const btn of buttons) {

            const text = await page.evaluate(el => el.innerText.toLowerCase(), btn);

            if (
                text.includes("redémarrer") ||
                text.includes("redemarrer") ||
                text.includes("restart")
            ) {
                restartBtn = btn;
                break;
            }
        }

        if (!restartBtn) {
            await log(channel, "❌ Bouton introuvable");
            await page.screenshot({ path: "error.png" });
            return;
        }

        await restartBtn.click();

        await sleep(3000);

        const confirm = await page.$$("button");

        if (confirm[1]) {
            await confirm[1].click();
        }

        await log(channel, "🎉 RESTART OK");

    } catch (err) {
        console.error(err);
        await log(channel, "❌ ERREUR: " + err.message);
    }
}

// =======================
// STOP SYSTEM
// =======================
async function stopSystem(channel) {

    clearInterval(interval);
    interval = null;

    if (browser) {
        await browser.close();
        browser = null;
        page = null;
    }

    await log(channel, "🛑 STOP");
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

        if (interval) return message.reply("⚠️ déjà actif");

        await log(channel, "🚀 SYSTEME ACTIVÉ (RENDER FIX)");

        await restartServer(channel);

        interval = setInterval(async () => {

            await log(channel, "⏱️ restart auto 3h");

            await restartServer(channel);

        }, 3 * 60 * 60 * 1000);

        message.reply("✅ activé");

    }

    if (message.content === "!stop") {

        await stopSystem(channel);
        message.reply("🛑 stop");
    }
});

client.login(process.env.DISCORD_TOKEN);