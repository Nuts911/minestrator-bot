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
    console.log("[LOG]", msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

// =======================
// BROWSER INIT
// =======================
async function getBrowser() {
    if (browser) {
        try {
            // Vérifie que le browser est encore vivant
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

    // User-agent réaliste pour éviter la détection bot
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
// RESTART SERVER
// =======================
async function restartServer(channel) {
    try {

        // Reset browser à chaque restart pour éviter les sessions corrompues
        if (browser) {
            try { await browser.close(); } catch {}
            browser = null;
            page = null;
        }

        await getBrowser();

        // ---- ÉTAPE 1 : LOGIN ----
        await log(channel, "🌐 Connexion à MineStrator...");

        await page.goto("https://minestrator.com/login", {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await sleep(3000);

        // Attend que les champs soient présents
        await page.waitForSelector("input", { timeout: 15000 });

        const inputs = await page.$$("input");

        if (inputs.length < 2) {
            await log(channel, "❌ Champs de login introuvables sur la page.");
            await page.screenshot({ path: "/tmp/error_login.png" });
            return;
        }

        // Efface et tape les identifiants
        await inputs[0].click({ clickCount: 3 });
        await inputs[0].type(process.env.MINESTRATOR_EMAIL, { delay: 60 });

        await inputs[1].click({ clickCount: 3 });
        await inputs[1].type(process.env.MINESTRATOR_PASSWORD, { delay: 60 });

        await page.keyboard.press("Enter");

        // Attend la navigation post-login
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await sleep(3000);

        // Vérifie qu'on est bien connecté
        const currentUrl = page.url();
        if (currentUrl.includes("/login")) {
            await log(channel, "❌ Échec login — vérifiez email/mot de passe.");
            await page.screenshot({ path: "/tmp/error_auth.png" });
            return;
        }

        await log(channel, "✅ Connecté ! Accès au panneau serveur...");

        // ---- ÉTAPE 2 : PAGE SERVEUR ----
        await page.goto(process.env.SERVER_URL, {
            waitUntil: "domcontentloaded",
            timeout: 30000
        });

        await sleep(5000);

        await log(channel, "🔍 Recherche du bouton restart...");

        // Cherche tous les boutons visibles
        const restartBtn = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
            return buttons.find(el => {
                const text = el.innerText?.toLowerCase() || "";
                return (
                    text.includes("redémarrer") ||
                    text.includes("redemarrer") ||
                    text.includes("restart") ||
                    text.includes("reboot")
                );
            }) || null;
        });

        const isFound = await page.evaluate(el => el !== null, restartBtn);

        if (!isFound) {
            await log(channel, "❌ Bouton restart introuvable. Screenshot sauvegardé.");
            await page.screenshot({ path: "/tmp/error_btn.png" });
            return;
        }

        await restartBtn.click();
        await sleep(2000);

        // ---- ÉTAPE 3 : CONFIRMATION ----
        // Cherche un bouton de confirmation dans une modale éventuelle
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

        if (confirmed) {
            await log(channel, "🎉 RESTART CONFIRMÉ ET LANCÉ !");
        } else {
            await log(channel, "🎉 RESTART LANCÉ (pas de confirmation nécessaire) !");
        }

    } catch (err) {
        console.error("[ERREUR]", err);
        await log(channel, "❌ ERREUR: " + err.message);

        // Reset propre en cas d'erreur
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

    // !start — active le bot et lance un premier restart
    if (message.content === "!start") {
        if (interval) return message.reply("⚠️ Le système est déjà actif !");

        await message.reply("🚀 Système activé ! Premier restart en cours...");
        await restartServer(channel);

        interval = setInterval(async () => {
            await log(channel, "⏱️ Restart automatique toutes les 3h...");
            await restartServer(channel);
        }, 3 * 60 * 60 * 1000);
    }

    // !stop — stoppe tout
    if (message.content === "!stop") {
        await stopSystem(channel);
        await message.reply("🛑 Système arrêté.");
    }

    // !restart — force un restart immédiat sans relancer le timer
    if (message.content === "!restart") {
        await message.reply("🔄 Restart manuel en cours...");
        await restartServer(channel);
    }

    // !status — indique si le système est actif
    if (message.content === "!status") {
        if (interval) {
            await message.reply("✅ Système **actif** — restart auto toutes les 3h.");
        } else {
            await message.reply("🔴 Système **inactif** — tape `!start` pour démarrer.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);