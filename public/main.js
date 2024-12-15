// Initialize Socket.IO with configuration
const socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
});

let isAuthenticated = false;

socket.on('connect', () => {
    console.log('Connected to server');
    if (!isAuthenticated) {
        showJoinModal();
    }
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    errorMessage.textContent = 'Connection error. Please try again.';
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    isAuthenticated = false;
});

const whiteboard = document.getElementById('whiteboard');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const highlightBtn = document.getElementById('highlightBtn');
const undoBtn = document.getElementById('undoBtn');
const joinModal = document.getElementById('joinModal');
const roomIdInput = document.getElementById('roomIdInput');
const passcodeInput = document.getElementById('passcodeInput');
const joinBtn = document.getElementById('joinBtn');
const errorMessage = document.getElementById('errorMessage');
const userCount = document.getElementById('userCount');
const roomInfo = document.getElementById('roomInfo');
const passcodeHint = document.getElementById('passcodeHint');
const storageInfo = document.getElementById('storageInfo');

// Get room ID from URL or generate new one
const pathParts = window.location.pathname.split('/');
const roomId = pathParts[1] === 'new' ? '' : pathParts[1];
roomIdInput.value = roomId;

// Show join modal with improved info
function showJoinModal() {
    if (!roomIdInput.value && window.location.pathname !== '/new') {
        window.location.href = '/new';
        return;
    }

    joinModal.style.display = 'flex';
    const isNewBoard = !roomId || window.location.pathname === '/new';
    
    if (isNewBoard) {
        const defaultPasscode = Math.random().toString(36).substring(2, 8);
        passcodeInput.value = defaultPasscode;
        roomInfo.textContent = 'Create a new whiteboard!';
        passcodeHint.textContent = 'Share this passcode with others to collaborate';
    } else {
        roomInfo.textContent = 'Join existing whiteboard';
        passcodeHint.textContent = 'Enter the passcode to join';
    }
}

// Show join modal by default if not authenticated
if (!isAuthenticated) {
    showJoinModal();
}

const cursors = new Map();

// Join room functionality
joinBtn.addEventListener('click', async () => {
    const roomId = roomIdInput.value.trim();
    const passcode = passcodeInput.value.trim();
    const errorMessage = document.getElementById('errorMessage');

    if (!passcode) {
        errorMessage.textContent = 'Please enter a passcode';
        return;
    }

    try {
        errorMessage.textContent = '';
        joinBtn.disabled = true;
        joinBtn.textContent = 'Joining...';

        // For new whiteboards, create them first
        const isNewBoard = !roomId;
        if (isNewBoard) {
            console.log('Creating new whiteboard...');
            const createResponse = await fetch('/new', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ passcode })
            });
            
            if (!createResponse.ok) {
                const createData = await createResponse.json();
                throw new Error(createData.error || 'Failed to create whiteboard');
            }

            const createData = await createResponse.json();
            roomIdInput.value = createData.roomId;
            console.log('Whiteboard created successfully');
        }

        const currentRoomId = roomIdInput.value.trim();
        console.log('Joining whiteboard...');
        const joinResponse = await fetch(`/join/${currentRoomId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ passcode })
        });

        if (!joinResponse.ok) {
            const joinData = await joinResponse.json();
            throw new Error(joinData.error || 'Failed to join whiteboard');
        }

        const joinData = await joinResponse.json();
        console.log('Successfully joined whiteboard');
        
        // Save passcode for new boards
        if (isNewBoard) {
            sessionStorage.setItem(`passcode-${currentRoomId}`, passcode);
        }

        // Join the room via socket
        socket.emit('join-room', { roomId: currentRoomId, passcode });
        
        // Hide the modal
        const modal = document.getElementById('joinModal');
        modal.style.display = 'none';
        isAuthenticated = true;
    } catch (err) {
        console.error('Join error:', err);
        errorMessage.textContent = err.message;
    } finally {
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join';
    }
});

// Handle successful room join
socket.on('room-joined', () => {
    console.log('Room joined successfully');
    joinModal.style.display = 'none';
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join';
    sessionStorage.setItem(`passcode-${roomIdInput.value}`, passcodeInput.value);
    isAuthenticated = true;
});

// Handle join error
socket.on('join-error', (error) => {
    console.error('Socket join error:', error);
    errorMessage.textContent = error;
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join';
});

// Cursor tracking
function createCursor(id, color) {
    const cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.style.background = color;
    whiteboard.appendChild(cursor);
    return cursor;
}

whiteboard.addEventListener('mousemove', (e) => {
    const rect = whiteboard.getBoundingClientRect();
    const position = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    socket.emit('cursor-move', position);
});

// Handle remote cursor updates
socket.on('cursor-update', ({ id, color, position }) => {
    let cursor = cursors.get(id);
    if (!cursor) {
        cursor = createCursor(id, color);
        cursors.set(id, cursor);
    }
    cursor.style.left = `${position.x}px`;
    cursor.style.top = `${position.y}px`;
});

// Handle user updates
socket.on('users-update', ({ users }) => {
    userCount.textContent = `Users: ${users.length}`;
    
    // Clean up disconnected users' cursors
    const connectedIds = users.map(u => u.id);
    cursors.forEach((cursor, id) => {
        if (!connectedIds.includes(id)) {
            cursor.remove();
            cursors.delete(id);
        }
    });
    
    // Add new users' cursors
    users.forEach(({ id, color }) => {
        if (!cursors.has(id) && id !== socket.id) {
            cursors.set(id, createCursor(id, color));
        }
    });
});

// Initialize whiteboard content
socket.on('init-whiteboard', (content) => {
    content.forEach(item => {
        if (item.type === 'text') {
            const textDisplay = document.createElement('div');
            textDisplay.className = 'text-display';
            textDisplay.style.left = `${item.position.x}px`;
            textDisplay.style.top = `${item.position.y}px`;
            textDisplay.textContent = item.text;
            whiteboard.appendChild(textDisplay);
        } else if (item.type === 'highlight') {
            // Recreate highlights
            const textDisplays = document.querySelectorAll('.text-display');
            textDisplays.forEach(display => {
                if (display.textContent.includes(item.text)) {
                    const span = document.createElement('span');
                    span.className = 'highlighted';
                    span.textContent = item.text;
                    display.appendChild(span);
                }
            });
        }
    });
});

// Error handling
socket.on('error', (message) => {
    errorMessage.textContent = message;
    joinModal.style.display = 'flex';
});

let isHighlightMode = false;
const undoStack = [];

// Handle room events
socket.on('user-joined', (data) => {
    console.log(`Users in room: ${data.users}`);
});

socket.on('user-left', (data) => {
    console.log(`Users in room: ${data.users}`);
});

// Handle text box creation
whiteboard.addEventListener('click', (e) => {
    if (!isAuthenticated) {
        showJoinModal();
        return;
    }
    
    if (e.target === whiteboard && !isHighlightMode) {
        createTextBox(e.clientX, e.clientY);
    }
});

function createTextBox(x, y) {
    if (isHighlightMode || !isAuthenticated) return;
    
    const textBox = document.createElement('textarea');
    textBox.className = 'text-box editing';
    
    // Adjust position relative to whiteboard
    const rect = whiteboard.getBoundingClientRect();
    textBox.style.left = (x - rect.left) + 'px';
    textBox.style.top = (y - rect.top) + 'px';
    
    whiteboard.appendChild(textBox);
    textBox.focus();

    // Handle text input
    textBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitText(textBox);
        } else if (e.key === 'Escape') {
            textBox.remove();
        }
    });

    // Handle blur event
    textBox.addEventListener('blur', () => {
        if (textBox.value.trim()) {
            submitText(textBox);
        } else {
            textBox.remove();
        }
    });

    // Emit new textbox event
    socket.emit('new-textbox', { x: x - rect.left, y: y - rect.top, roomId: roomIdInput.value });
}

function submitText(textBox) {
    const text = textBox.value.trim();
    if (text) {
        const textDisplay = document.createElement('div');
        textDisplay.className = 'text-display';
        textDisplay.style.left = textBox.style.left;
        textDisplay.style.top = textBox.style.top;
        textDisplay.textContent = text;
        
        whiteboard.appendChild(textDisplay);
        
        // Add to undo stack
        undoStack.push({
            type: 'text',
            element: textDisplay
        });
        
        socket.emit('text-update', {
            text: text,
            x: textDisplay.style.left,
            y: textDisplay.style.top,
            roomId: roomIdInput.value
        });
    }
    textBox.remove();
}

// Highlight functionality
highlightBtn.addEventListener('click', () => {
    isHighlightMode = !isHighlightMode;
    highlightBtn.style.backgroundColor = isHighlightMode ? '#ffeb3b' : '#333';
    document.body.style.cursor = isHighlightMode ? 'crosshair' : 'default';
    
    // Toggle highlight mode for all text displays
    const textDisplays = document.querySelectorAll('.text-display');
    textDisplays.forEach(display => {
        if (isHighlightMode) {
            display.classList.add('highlight-enabled');
        } else {
            display.classList.remove('highlight-enabled');
        }
    });
});

// Handle text selection and highlighting
document.addEventListener('mouseup', (e) => {
    if (!isHighlightMode) return;
    
    const selection = window.getSelection();
    if (!selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const selectedText = range.toString().trim();
        
        // Check if selection is within a text-display element
        const textDisplay = range.commonAncestorContainer.parentElement.closest('.text-display');
        if (selectedText && textDisplay) {
            try {
                const highlightSpan = document.createElement('span');
                highlightSpan.className = 'highlighted';
                range.surroundContents(highlightSpan);
                
                // Add to undo stack
                undoStack.push({
                    type: 'highlight',
                    element: highlightSpan
                });
                
                socket.emit('highlight-update', {
                    text: selectedText,
                    position: {
                        x: highlightSpan.offsetLeft,
                        y: highlightSpan.offsetTop
                    },
                    roomId: roomIdInput.value
                });
            } catch (error) {
                console.error('Error applying highlight:', error);
            }
        }
    }
    // Clear the selection after highlighting
    selection.removeAllRanges();
});

// Undo functionality
undoBtn.addEventListener('click', () => {
    if (undoStack.length > 0) {
        const lastAction = undoStack.pop();
        if (lastAction.element) {
            if (lastAction.type === 'highlight') {
                // For highlights, unwrap the span
                const parent = lastAction.element.parentNode;
                while (lastAction.element.firstChild) {
                    parent.insertBefore(lastAction.element.firstChild, lastAction.element);
                }
                lastAction.element.remove();
            } else {
                // For text boxes, just remove the element
                lastAction.element.remove();
            }
        }
        socket.emit('undo', { roomId: roomIdInput.value });
    }
});

// Clear board functionality
clearBtn.addEventListener('click', () => {
    const textDisplays = document.querySelectorAll('.text-display');
    textDisplays.forEach(display => display.remove());
    undoStack.length = 0; // Clear undo stack
    socket.emit('clear-board', { roomId: roomIdInput.value });
});

// Save board functionality
saveBtn.addEventListener('click', async () => {
    try {
        const canvas = await html2canvas(whiteboard);
        const link = document.createElement('a');
        link.download = 'whiteboard.png';
        link.href = canvas.toDataURL();
        link.click();
    } catch (error) {
        console.error('Error saving whiteboard:', error);
    }
});

// Socket event handlers
socket.on('new-textbox', (data) => {
    createTextBox(data.x + whiteboard.getBoundingClientRect().left, 
                 data.y + whiteboard.getBoundingClientRect().top);
});

socket.on('text-update', (data) => {
    const textDisplay = document.createElement('div');
    textDisplay.className = 'text-display';
    textDisplay.style.left = data.x;
    textDisplay.style.top = data.y;
    textDisplay.textContent = data.text;
    whiteboard.appendChild(textDisplay);
});

socket.on('highlight-update', (data) => {
    // Handle remote highlight updates
    const textDisplays = document.querySelectorAll('.text-display');
    textDisplays.forEach(display => {
        if (display.textContent.includes(data.text)) {
            const span = document.createElement('span');
            span.className = 'highlighted';
            span.textContent = data.text;
            display.appendChild(span);
        }
    });
});

socket.on('clear-board', () => {
    const textDisplays = document.querySelectorAll('.text-display');
    textDisplays.forEach(display => display.remove());
    undoStack.length = 0; // Clear undo stack
});

socket.on('undo', () => {
    if (undoStack.length > 0) {
        const lastAction = undoStack.pop();
        if (lastAction.element) {
            lastAction.element.remove();
        }
    }
});
