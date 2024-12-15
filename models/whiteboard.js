const mongoose = require('mongoose');

const whiteboardSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        unique: true
    },
    passcode: {
        type: String,
        required: true
    },
    content: [{
        type: {
            type: String,
            enum: ['text', 'highlight'],
            required: true
        },
        text: String,
        position: {
            x: Number,
            y: Number
        },
        style: Object
    }],
    lastAccessed: {
        type: Date,
        default: Date.now
    }
});

// Automatically remove whiteboards that haven't been accessed in 24 hours
whiteboardSchema.index({ lastAccessed: 1 }, { 
    expireAfterSeconds: 86400 
});

module.exports = mongoose.model('Whiteboard', whiteboardSchema);
