# Minimalist Whiteboard

A real-time collaborative whiteboard application with a clean, minimalist interface.

## Features

- Create text boxes by clicking anywhere on the whiteboard
- Real-time collaboration with multiple users
- Text formatting: Helvetica while editing, Comic Sans when submitted
- Highlight text functionality
- Save whiteboard as PNG
- Clear all content with one click
- Responsive design for both desktop and mobile

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to `http://localhost:3000`

## Usage

- Click anywhere on the whiteboard to create a text box
- Type your text (Shift + Enter for new line)
- Press Enter to submit text
- Use the toolbar buttons to:
  - Clear the whiteboard
  - Save the whiteboard as PNG
  - Toggle highlight mode

## Technologies Used

- Node.js
- Express
- Socket.IO
- HTML5 Canvas
- HTML2Canvas
