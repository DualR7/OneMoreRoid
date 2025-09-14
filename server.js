const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Discord Webhook URL'leri
const DISCORD_WEBHOOK_URL_REPORT = 'https://discord.com/api/webhooks/1416549847397564468/tOt0Rv38DcKjK8bgVMlXxHlLDQ7tURYgj8Onca4YhhUEuyt_gpUpWDdppzhEaSBN9IPd';
const DISCORD_WEBHOOK_URL_MOD = 'https://discord.com/api/webhooks/1416563780665610340/TMI-puyYaWSH3HdR7DA9IbQtLXFRM638BRdBO_UdPqgnJMiAmT0zumnkkUbNhOANjqBq'; // Moderasyon işlemlerini izlemek için yeni bir webhook

// Veri depolama
const usersInRooms = {};
const chatHistory = {};
const BANNED_USERS = {};
const MUTED_USERS = {};
let currentAnnouncement = '';

// Yönetici listesi
const ADMINS = ['exesayc'];

app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Yasaklı kullanıcı kontrolü
app.post('/is-banned', (req, res) => {
    const { username } = req.body;
    if (BANNED_USERS[username]) {
        res.json({ banned: true, reason: BANNED_USERS[username] });
    } else {
        res.json({ banned: false });
    }
});

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı.');

    socket.on('join room', (room, username) => {
        if (BANNED_USERS[username]) {
            socket.emit('moderation', `Yasaklandınız! Sebep: ${BANNED_USERS[username]}`);
            return;
        }

        socket.join(room);
        socket.username = username;
        socket.room = room;

        if (!usersInRooms[room]) {
            usersInRooms[room] = [];
        }
        if (!usersInRooms[room].includes(username)) {
            usersInRooms[room].push(username);
        }

        io.to(room).emit('chat message', { username: 'Sistem', text: `${username} odaya katıldı.` });
        io.to(room).emit('update user list', usersInRooms[room]);
        socket.emit('update announcement', currentAnnouncement);

        if (chatHistory[room]) {
            chatHistory[room].forEach(msg => {
                socket.emit('chat message', msg);
            });
        }
    });

    socket.on('chat message', (msg) => {
        if (MUTED_USERS[msg.username]) {
            socket.emit('moderation', `Susturuldunuz! Sebep: ${MUTED_USERS[msg.username]}`);
            return;
        }

        const messageWithTime = {
            username: msg.username,
            text: msg.text,
            time: new Date().toLocaleTimeString()
        };
        io.to(msg.room).emit('chat message', messageWithTime);

        if (!chatHistory[msg.room]) {
            chatHistory[msg.room] = [];
        }
        chatHistory[msg.room].push(messageWithTime);
        if (chatHistory[msg.room].length > 50) {
            chatHistory[msg.room].shift();
        }
    });

    // Yönetici Paneli - Duyuru
    socket.on('set announcement', (announcement) => {
        if (ADMINS.includes(socket.username)) {
            currentAnnouncement = announcement;
            io.emit('update announcement', currentAnnouncement);
        }
    });

    // Yönetici Paneli - Susturma
    socket.on('mute user', ({ username, reason }) => {
        if (ADMINS.includes(socket.username)) {
            MUTED_USERS[username] = reason;
            io.emit('chat message', { username: 'Sistem', text: `${username} kullanıcısı susturuldu. Sebep: ${reason}` });
        }
    });

    // Yönetici Paneli - Atma
    socket.on('kick user', ({ username, reason }) => {
        if (ADMINS.includes(socket.username)) {
            io.emit('chat message', { username: 'Sistem', text: `${username} kullanıcısı atıldı. Sebep: ${reason}` });
            io.sockets.sockets.forEach(s => {
                if (s.username === username) {
                    s.disconnect(true);
                }
            });
        }
    });

    // Yönetici Paneli - Yasaklama
    socket.on('ban user', ({ username, reason }) => {
        if (ADMINS.includes(socket.username)) {
            BANNED_USERS[username] = reason;
            io.emit('chat message', { username: 'Sistem', text: `${username} kullanıcısı yasaklandı. Sebep: ${reason}` });

            const embed = {
                title: 'Kullanıcı Yasaklandı',
                color: 16711680,
                description: `**Yasaklayan:** ${socket.username}\n**Yasaklanan:** ${username}\n**Sebep:** ${reason}`,
                timestamp: new Date()
            };
            axios.post(DISCORD_WEBHOOK_URL_MOD, { embeds: [embed] });

            io.sockets.sockets.forEach(s => {
                if (s.username === username) {
                    s.disconnect(true);
                }
            });
        }
    });

    // Yönetici Paneli - Sohbeti Temizleme
    socket.on('clear chat', (room) => {
        if (ADMINS.includes(socket.username)) {
            chatHistory[room] = [];
            io.to(room).emit('chat message', { username: 'Sistem', text: 'Sohbet yöneticiler tarafından temizlendi.' });
        }
    });

    socket.on('typing', (room, username) => {
        socket.to(room).emit('typing', username);
    });

    socket.on('stop typing', (room) => {
        socket.to(room).emit('stop typing');
    });

    socket.on('disconnect', () => {
        if (socket.username && socket.room) {
            const index = usersInRooms[socket.room].indexOf(socket.username);
            if (index > -1) {
                usersInRooms[socket.room].splice(index, 1);
            }
            io.to(socket.room).emit('chat message', { username: 'Sistem', text: `${socket.username} odadan ayrıldı.` });
            io.to(socket.room).emit('update user list', usersInRooms[socket.room]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server http://localhost:${PORT} adresinde çalışıyor...`);
});