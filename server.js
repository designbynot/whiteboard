require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// Error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

// MongoDB connection with better error handling and retries
const connectWithRetry = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB Atlas');
        return true;
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        return false;
    }
};

// Initial connection attempt with retries
let retryCount = 0;
const maxRetries = 3;

const attemptConnection = async () => {
    while (retryCount < maxRetries) {
        console.log(`Attempting MongoDB connection (attempt ${retryCount + 1}/${maxRetries})...`);
        const connected = await connectWithRetry();
        if (connected) {
            return true;
        }
        retryCount++;
        if (retryCount < maxRetries) {
            console.log('Waiting 5 seconds before retrying...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    return false;
};

// Start connection attempts
attemptConnection().then(connected => {
    if (!connected) {
        console.error('Failed to connect to MongoDB after multiple attempts');
    }
});

// Middleware - must come before routes
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Define the Whiteboard model
const whiteboardSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    passcode: { type: String, required: true },
    content: { type: Array, default: [] },
    lastAccessed: { type: Date, default: Date.now }
});

const Whiteboard = mongoose.models.Whiteboard || mongoose.model('Whiteboard', whiteboardSchema);

// Store active users and their cursors
const activeUsers = new Map();

// Generate a random room ID
function generateRoomId() {
    return crypto.randomBytes(4).toString('hex');
}

// Generate a random color for user cursor
function generateUserColor() {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];
    return colors[Math.floor(Math.random() * colors.length)];
}

// API Routes
app.post('/new', async (req, res) => {
    try {
        // Check MongoDB connection first
        if (mongoose.connection.readyState !== 1) {
            console.log('MongoDB not connected, attempting to reconnect...');
            const connected = await connectWithRetry();
            if (!connected) {
                throw new Error('Unable to connect to database');
            }
        }

        const { passcode } = req.body;
        if (!passcode) {
            return res.status(400).json({ error: 'Passcode is required' });
        }

        const roomId = generateRoomId();
        const hashedPasscode = await bcrypt.hash(passcode, 10);

        const whiteboard = new Whiteboard({
            roomId,
            passcode: hashedPasscode,
            content: [],
            lastAccessed: new Date()
        });

        console.log('Attempting to save whiteboard:', { roomId });
        await Promise.race([
            whiteboard.save(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Save operation timed out')), 20000)
            )
        ]);
        console.log('Whiteboard saved successfully');
        
        res.status(201).json({ roomId });
    } catch (err) {
        console.error('Create whiteboard error:', err);
        if (err.code === 11000) {
            res.status(409).json({ error: 'Room ID already exists, please try again' });
        } else {
            res.status(500).json({ error: `Failed to create whiteboard: ${err.message}` });
        }
    }
});

app.post('/join/:roomId', async (req, res) => {
    try {
        // Check MongoDB connection first
        if (mongoose.connection.readyState !== 1) {
            console.log('MongoDB not connected on join, attempting to reconnect...');
            const connected = await connectWithRetry();
            if (!connected) {
                throw new Error('Unable to connect to database');
            }
        }

        const { roomId } = req.params;
        const { passcode } = req.body;

        if (!roomId || !passcode) {
            console.log('Join attempt failed: Missing roomId or passcode');
            return res.status(400).json({ error: 'Room ID and passcode are required' });
        }

        console.log(`Attempting to find whiteboard with roomId: ${roomId}`);
        const whiteboard = await Promise.race([
            Whiteboard.findOne({ roomId }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Database query timed out')), 20000)
            )
        ]);

        if (!whiteboard) {
            console.log(`Whiteboard not found: ${roomId}`);
            return res.status(404).json({ error: 'Whiteboard not found' });
        }

        const isPasscodeValid = await bcrypt.compare(passcode, whiteboard.passcode);
        if (!isPasscodeValid) {
            console.log(`Invalid passcode for room: ${roomId}`);
            return res.status(401).json({ error: 'Invalid passcode' });
        }

        // Update last accessed time
        whiteboard.lastAccessed = new Date();
        await whiteboard.save();

        console.log(`Successfully joined whiteboard: ${roomId}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Join whiteboard error:', err);
        res.status(500).json({ error: `Server error: ${err.message}` });
    }
});

// Page Routes - must come after API routes
app.get('/', (req, res) => {
    const roomId = generateRoomId();
    res.redirect(`/${roomId}`);
});

app.get('/new', (req, res) => {
    const roomId = generateRoomId();
    res.redirect(`/${roomId}`);
});

app.get('/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected');
    let currentRoom = null;
    let userColor = null;

    socket.on('join-room', async ({ roomId, passcode }) => {
        try {
            console.log('Socket attempting to join room:', roomId);
            const whiteboard = await Whiteboard.findOne({ roomId });
            if (!whiteboard) {
                socket.emit('join-error', 'Whiteboard not found');
                return;
            }

            const isValidPasscode = await bcrypt.compare(passcode, whiteboard.passcode);
            if (!isValidPasscode) {
                socket.emit('join-error', 'Invalid passcode');
                return;
            }

            if (currentRoom) {
                socket.leave(currentRoom);
                const roomUsers = activeUsers.get(currentRoom) || new Map();
                roomUsers.delete(socket.id);
                activeUsers.set(currentRoom, roomUsers);
                io.to(currentRoom).emit('user-count', roomUsers.size);
            }

            currentRoom = roomId;
            socket.join(roomId);
            
            if (!activeUsers.has(roomId)) {
                activeUsers.set(roomId, new Map());
            }
            const roomUsers = activeUsers.get(roomId);
            userColor = generateUserColor();
            roomUsers.set(socket.id, { color: userColor });
            
            whiteboard.lastAccessed = new Date();
            await whiteboard.save();

            console.log('Client joined room successfully');
            socket.emit('room-joined');
            io.to(roomId).emit('user-count', roomUsers.size);
            socket.broadcast.to(roomId).emit('user-joined', { id: socket.id, color: userColor });
            
            if (whiteboard.content) {
                socket.emit('load-content', whiteboard.content);
            }
        } catch (err) {
            console.error('Socket join error:', err);
            socket.emit('join-error', 'Failed to join room');
        }
    });

    socket.on('cursor-move', (position) => {
        if (currentRoom && activeUsers.has(socket.id)) {
            const userData = activeUsers.get(socket.id);
            userData.position = position;
            socket.to(currentRoom).emit('cursor-update', {
                id: socket.id,
                color: userData.color,
                position
            });
        }
    });

    socket.on('text-update', async (data) => {
        if (currentRoom) {
            socket.to(currentRoom).emit('text-update', data);
            try {
                await Whiteboard.updateOne(
                    { roomId: currentRoom },
                    { 
                        $push: { content: {
                            type: 'text',
                            text: data.text,
                            position: { x: data.x, y: data.y }
                        }},
                        lastAccessed: new Date()
                    }
                );
            } catch (error) {
                console.error('Error saving text:', error);
            }
        }
    });

    socket.on('highlight-update', async (data) => {
        if (currentRoom) {
            socket.to(currentRoom).emit('highlight-update', data);
            try {
                await Whiteboard.updateOne(
                    { roomId: currentRoom },
                    { 
                        $push: { content: {
                            type: 'highlight',
                            text: data.text,
                            position: data.position
                        }},
                        lastAccessed: new Date()
                    }
                );
            } catch (error) {
                console.error('Error saving highlight:', error);
            }
        }
    });

    socket.on('clear-board', async () => {
        if (currentRoom) {
            socket.to(currentRoom).emit('clear-board');
            try {
                await Whiteboard.updateOne(
                    { roomId: currentRoom },
                    { 
                        $set: { content: [] },
                        lastAccessed: new Date()
                    }
                );
            } catch (error) {
                console.error('Error clearing board:', error);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        if (currentRoom) {
            const roomUsers = activeUsers.get(currentRoom);
            if (roomUsers) {
                roomUsers.delete(socket.id);
                io.to(currentRoom).emit('user-count', roomUsers.size);
                io.to(currentRoom).emit('user-left', socket.id);
            }
        }
    });
});

// Storage cleanup - run every hour
setInterval(async () => {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        // Delete inactive whiteboards
        await Whiteboard.deleteMany({ lastAccessed: { $lt: twentyFourHoursAgo } });
        
        // Compress data for boards inactive for 1 hour
        const inactiveBoards = await Whiteboard.find({ lastAccessed: { $lt: oneHourAgo } });
        for (const board of inactiveBoards) {
            if (board.content) {
                // Keep only essential data and compress long content
                const compressedContent = board.content
                    .filter(item => item.type === 'text' || item.type === 'highlight')
                    .map(item => ({
                        type: item.type,
                        x: Math.round(item.x),
                        y: Math.round(item.y),
                        text: item.text ? item.text.substring(0, 1000) : undefined
                    }));
                board.content = compressedContent;
                await board.save();
            }
        }
    } catch (err) {
        console.error('Storage cleanup error:', err);
    }
}, 60 * 60 * 1000); // Run every hour

// Start server with error handling
const PORT = process.env.PORT || 3002;
const server = http.listen(PORT, '0.0.0.0', (err) => {
    if (err) {
        console.error('Error starting server:', err);
        process.exit(1);
    }
    console.log(`Server running on port ${PORT}`);
});

// Handle server errors
server.on('error', (err) => {
    console.error('Server error:', err);
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
        process.exit(1);
    }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Performing graceful shutdown...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
