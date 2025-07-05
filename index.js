require('dotenv').config();
const express = require('express');
const moment = require('moment-timezone');
const schedule = require('node-schedule');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, push, remove } = require('firebase/database');

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let latestNextTimer = null; // Store next timer globally

// Serve HTML UI directly from here
app.get('/', async (req, res) => {
  const relaysSnapshot = await get(ref(db, 'relays'));
  const timersSnapshot = await get(ref(db, 'timers'));
  
  const relays = relaysSnapshot.exists() ? relaysSnapshot.val() : {};
  const timers = timersSnapshot.exists() ? timersSnapshot.val() : {};

  let statusHtml = '';
  for (const [relay, state] of Object.entries(relays)) {
    statusHtml += `
      <div class="relay-card">
        <div class="relay-header">
          <h3>${relay.toUpperCase()}</h3>
          <div class="status-indicator ${state ? 'on' : 'off'}"></div>
        </div>
        <div class="relay-status">
          <span class="status-text ${state ? 'on' : 'off'}">${state ? 'ON' : 'OFF'}</span>
        </div>
        <div class="relay-controls">
          <button class="btn btn-on ${state ? 'active' : ''}" onclick="toggleRelay('${relay}', true)">
            <i class="icon">⚡</i> ON
          </button>
          <button class="btn btn-off ${!state ? 'active' : ''}" onclick="toggleRelay('${relay}', false)">
            <i class="icon">⭕</i> OFF
          </button>
        </div>
      </div>`;
  }

  let timersHtml = '';
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  for (const [id, timer] of Object.entries(timers)) {
    const activeDays = timer.days ? timer.days.map((active, index) => active ? dayNames[index] : null).filter(Boolean).join(', ') : 'None';
    timersHtml += `
      <div class="timer-card ${timer.active ? 'active' : 'inactive'}">
        <div class="timer-header">
          <h4>${timer.relay.toUpperCase()}</h4>
          <div class="timer-status ${timer.active ? 'active' : 'inactive'}">
            ${timer.active ? 'ACTIVE' : 'INACTIVE'}
          </div>
        </div>
        <div class="timer-details">
          <div class="timer-info">
            <span class="timer-action ${timer.action.toLowerCase()}">${timer.action}</span>
            <span class="timer-time">${timer.startTime}${timer.endTime ? ' - ' + timer.endTime : ''}</span>
          </div>
          <div class="timer-days">${activeDays}</div>
        </div>
        <div class="timer-controls">
          <button class="btn btn-edit" onclick="editTimer('${id}')">
            <i class="icon">✏️</i> Edit
          </button>
          <button class="btn btn-delete" onclick="deleteTimer('${id}')">
            <i class="icon">🗑️</i> Delete
          </button>
        </div>
      </div>`;
  }

  const nextTimerHtml = latestNextTimer
    ? `<div class="next-timer">
        <i class="icon">⏰</i>
        <span>Next: ${latestNextTimer.relay.toUpperCase()} will turn <strong>${latestNextTimer.action}</strong> at <strong>${latestNextTimer.time.format('HH:mm')}</strong></span>
      </div>`
    : `<div class="next-timer no-timer">
        <i class="icon">⏰</i>
        <span>No upcoming timers for today</span>
      </div>`;

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Smart Home Control</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
            line-height: 1.6;
          }
          
          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
          }
          
          .header {
            text-align: center;
            margin-bottom: 30px;
            color: white;
          }
          
          .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
          }
          
          .header p {
            font-size: 1.2em;
            opacity: 0.9;
          }
          
          .section {
            background: white;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          }
          
          .section h2 {
            font-size: 1.8em;
            margin-bottom: 20px;
            color: #333;
            border-bottom: 3px solid #667eea;
            padding-bottom: 10px;
          }
          
          .next-timer {
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            margin-bottom: 25px;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 1.1em;
            box-shadow: 0 5px 15px rgba(76, 175, 80, 0.3);
          }
          
          .next-timer.no-timer {
            background: linear-gradient(135deg, #757575, #616161);
          }
          
          .next-timer .icon {
            font-size: 1.3em;
          }
          
          .relays-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          
          .relay-card {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
          }
          
          .relay-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
          }
          
          .relay-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          
          .relay-header h3 {
            font-size: 1.3em;
            color: #333;
          }
          
          .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            animation: pulse 2s infinite;
          }
          
          .status-indicator.on {
            background: #4CAF50;
            box-shadow: 0 0 10px rgba(76, 175, 80, 0.5);
          }
          
          .status-indicator.off {
            background: #f44336;
            box-shadow: 0 0 10px rgba(244, 67, 54, 0.5);
          }
          
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
          
          .relay-status {
            text-align: center;
            margin-bottom: 20px;
          }
          
          .status-text {
            font-size: 1.5em;
            font-weight: bold;
            padding: 8px 20px;
            border-radius: 20px;
            display: inline-block;
          }
          
          .status-text.on {
            background: #E8F5E8;
            color: #4CAF50;
          }
          
          .status-text.off {
            background: #FFEBEE;
            color: #f44336;
          }
          
          .relay-controls {
            display: flex;
            gap: 10px;
          }
          
          .btn {
            flex: 1;
            padding: 12px 15px;
            border: none;
            border-radius: 8px;
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
          }
          
          .btn-on {
            background: #4CAF50;
            color: white;
          }
          
          .btn-on:hover {
            background: #45a049;
            transform: translateY(-2px);
          }
          
          .btn-off {
            background: #f44336;
            color: white;
          }
          
          .btn-off:hover {
            background: #da190b;
            transform: translateY(-2px);
          }
          
          .btn.active {
            box-shadow: 0 0 0 3px rgba(255,255,255,0.5);
          }
          
          .btn-primary {
            background: #667eea;
            color: white;
            padding: 15px 30px;
            font-size: 1.1em;
            margin-bottom: 20px;
          }
          
          .btn-primary:hover {
            background: #5a67d8;
            transform: translateY(-2px);
          }
          
          .btn-edit {
            background: #2196F3;
            color: white;
            padding: 8px 12px;
            font-size: 0.9em;
          }
          
          .btn-edit:hover {
            background: #1976D2;
          }
          
          .btn-delete {
            background: #f44336;
            color: white;
            padding: 8px 12px;
            font-size: 0.9em;
          }
          
          .btn-delete:hover {
            background: #da190b;
          }
          
          .timers-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
          }
          
          .timer-card {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.1);
            transition: transform 0.3s ease;
            border-left: 4px solid #ddd;
          }
          
          .timer-card.active {
            border-left-color: #4CAF50;
          }
          
          .timer-card.inactive {
            border-left-color: #f44336;
            opacity: 0.7;
          }
          
          .timer-card:hover {
            transform: translateY(-3px);
          }
          
          .timer-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          
          .timer-header h4 {
            font-size: 1.2em;
            color: #333;
          }
          
          .timer-status {
            font-size: 0.8em;
            font-weight: bold;
            padding: 4px 8px;
            border-radius: 4px;
          }
          
          .timer-status.active {
            background: #E8F5E8;
            color: #4CAF50;
          }
          
          .timer-status.inactive {
            background: #FFEBEE;
            color: #f44336;
          }
          
          .timer-details {
            margin-bottom: 15px;
          }
          
          .timer-info {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          
          .timer-action {
            font-weight: bold;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.9em;
          }
          
          .timer-action.on {
            background: #E8F5E8;
            color: #4CAF50;
          }
          
          .timer-action.off {
            background: #FFEBEE;
            color: #f44336;
          }
          
          .timer-time {
            font-family: monospace;
            font-size: 1.1em;
            font-weight: bold;
            color: #667eea;
          }
          
          .timer-days {
            font-size: 0.9em;
            color: #666;
          }
          
          .timer-controls {
            display: flex;
            gap: 10px;
          }
          
          .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
            backdrop-filter: blur(5px);
          }
          
          .modal-content {
            background: white;
            margin: 5% auto;
            padding: 30px;
            border-radius: 15px;
            width: 90%;
            max-width: 500px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          }
          
          .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
          }
          
          .modal-header h3 {
            color: #333;
            font-size: 1.5em;
          }
          
          .close {
            background: none;
            border: none;
            font-size: 2em;
            cursor: pointer;
            color: #999;
            padding: 0;
            width: 30px;
            height: 30px;
          }
          
          .close:hover {
            color: #333;
          }
          
          .form-group {
            margin-bottom: 20px;
          }
          
          .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
          }
          
          .form-group select,
          .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 1em;
            transition: border-color 0.3s ease;
          }
          
          .form-group select:focus,
          .form-group input:focus {
            outline: none;
            border-color: #667eea;
          }
          
          .days-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 5px;
          }
          
          .day-checkbox {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 8px;
            border: 2px solid #ddd;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9em;
          }
          
          .day-checkbox:hover {
            background: #f5f5f5;
          }
          
          .day-checkbox.active {
            background: #667eea;
            color: white;
            border-color: #667eea;
          }
          
          .day-checkbox input {
            display: none;
          }
          
          .form-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 25px;
          }
          
          .btn-secondary {
            background: #6c757d;
            color: white;
            padding: 12px 20px;
          }
          
          .btn-secondary:hover {
            background: #5a6268;
          }
          
          .empty-state {
            text-align: center;
            padding: 40px;
            color: #666;
          }
          
          .empty-state .icon {
            font-size: 3em;
            margin-bottom: 15px;
            display: block;
          }
          
          @media (max-width: 768px) {
            .container {
              padding: 10px;
            }
            
            .header h1 {
              font-size: 2em;
            }
            
            .relays-grid {
              grid-template-columns: 1fr;
            }
            
            .timers-grid {
              grid-template-columns: 1fr;
            }
            
            .modal-content {
              margin: 2% auto;
              width: 95%;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏠 Smart Home Control</h1>
            <p>Manage your relays and timers with ease</p>
          </div>
          
          ${nextTimerHtml}
          
          <div class="section">
            <h2>⚡ Relay Controls</h2>
            <div class="relays-grid">
              ${statusHtml || '<div class="empty-state"><span class="icon">🔌</span><p>No relays found</p></div>'}
            </div>
          </div>
          
          <div class="section">
            <h2>⏰ Timer Management</h2>
            <button class="btn btn-primary" onclick="openTimerModal()">
              <i class="icon">➕</i> Add New Timer
            </button>
            <div class="timers-grid">
              ${timersHtml || '<div class="empty-state"><span class="icon">⏰</span><p>No timers configured</p></div>'}
            </div>
          </div>
        </div>
        
        <!-- Timer Modal -->
        <div id="timerModal" class="modal">
          <div class="modal-content">
            <div class="modal-header">
              <h3 id="modalTitle">Add New Timer</h3>
              <button class="close" onclick="closeTimerModal()">&times;</button>
            </div>
            <form id="timerForm">
              <div class="form-group">
                <label for="timerRelay">Relay:</label>
                <select id="timerRelay" required>
                  <option value="">Select Relay</option>
                  ${Object.keys(relays).map(relay => `<option value="${relay}">${relay.toUpperCase()}</option>`).join('')}
                </select>
              </div>
              
              <div class="form-group">
                <label for="timerAction">Action:</label>
                <select id="timerAction" required>
                  <option value="">Select Action</option>
                  <option value="ON">Turn ON</option>
                  <option value="OFF">Turn OFF</option>
                </select>
              </div>
              
              <div class="form-group">
                <label for="timerStartTime">Start Time:</label>
                <input type="time" id="timerStartTime" required>
              </div>
              
              <div class="form-group">
                <label for="timerEndTime">End Time (Optional):</label>
                <input type="time" id="timerEndTime">
              </div>
              
              <div class="form-group">
                <label>Active Days:</label>
                <div class="days-grid">
                  <div class="day-checkbox" onclick="toggleDay(0)">
                    <input type="checkbox" id="day0">
                    <label for="day0">Mon</label>
                  </div>
                  <div class="day-checkbox" onclick="toggleDay(1)">
                    <input type="checkbox" id="day1">
                    <label for="day1">Tue</label>
                  </div>
                  <div class="day-checkbox" onclick="toggleDay(2)">
                    <input type="checkbox" id="day2">
                    <label for="day2">Wed</label>
                  </div>
                  <div class="day-checkbox" onclick="toggleDay(3)">
                    <input type="checkbox" id="day3">
                    <label for="day3">Thu</label>
                  </div>
                  <div class="day-checkbox" onclick="toggleDay(4)">
                    <input type="checkbox" id="day4">
                    <label for="day4">Fri</label>
                  </div>
                  <div class="day-checkbox" onclick="toggleDay(5)">
                    <input type="checkbox" id="day5">
                    <label for="day5">Sat</label>
                  </div>
                  <div class="day-checkbox" onclick="toggleDay(6)">
                    <input type="checkbox" id="day6">
                    <label for="day6">Sun</label>
                  </div>
                </div>
              </div>
              
              <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeTimerModal()">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Timer</button>
              </div>
            </form>
          </div>
        </div>
        
        <script>
          let currentEditingTimerId = null;
          
          // Toggle relay state
          async function toggleRelay(relay, state) {
            try {
              const response = await fetch('/relay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ relay, state })
              });
              
              if (response.ok) {
                location.reload();
              } else {
                alert('Error updating relay');
              }
            } catch (error) {
              alert('Error: ' + error.message);
            }
          }
          
          // Open timer modal
          function openTimerModal() {
            currentEditingTimerId = null;
            document.getElementById('modalTitle').textContent = 'Add New Timer';
            document.getElementById('timerForm').reset();
            resetDayCheckboxes();
            document.getElementById('timerModal').style.display = 'block';
          }
          
          // Close timer modal
          function closeTimerModal() {
            document.getElementById('timerModal').style.display = 'none';
            currentEditingTimerId = null;
          }
          
          // Toggle day checkbox
          function toggleDay(dayIndex) {
            const checkbox = document.getElementById('day' + dayIndex);
            const dayBox = checkbox.parentElement;
            
            checkbox.checked = !checkbox.checked;
            
            if (checkbox.checked) {
              dayBox.classList.add('active');
            } else {
              dayBox.classList.remove('active');
            }
          }
          
          // Reset day checkboxes
          function resetDayCheckboxes() {
            for (let i = 0; i < 7; i++) {
              const checkbox = document.getElementById('day' + i);
              const dayBox = checkbox.parentElement;
              checkbox.checked = false;
              dayBox.classList.remove('active');
            }
          }
          
          // Edit timer
          async function editTimer(timerId) {
            try {
              const response = await fetch('/timer/' + timerId);
              const timer = await response.json();
              
              if (timer) {
                currentEditingTimerId = timerId;
                document.getElementById('modalTitle').textContent = 'Edit Timer';
                document.getElementById('timerRelay').value = timer.relay;
                document.getElementById('timerAction').value = timer.action;
                document.getElementById('timerStartTime').value = timer.startTime;
                document.getElementById('timerEndTime').value = timer.endTime || '';
                
                // Set active days
                resetDayCheckboxes();
                if (timer.days) {
                  timer.days.forEach((active, index) => {
                    if (active) {
                      const checkbox = document.getElementById('day' + index);
                      const dayBox = checkbox.parentElement;
                      checkbox.checked = true;
                      dayBox.classList.add('active');
                    }
                  });
                }
                
                document.getElementById('timerModal').style.display = 'block';
              }
            } catch (error) {
              alert('Error loading timer: ' + error.message);
            }
          }
          
          // Delete timer
          async function deleteTimer(timerId) {
            if (confirm('Are you sure you want to delete this timer?')) {
              try {
                const response = await fetch('/timer/' + timerId, {
                  method: 'DELETE'
                });
                
                if (response.ok) {
                  location.reload();
                } else {
                  alert('Error deleting timer');
                }
              } catch (error) {
                alert('Error: ' + error.message);
              }
            }
          }
          
          // Submit timer form
          document.getElementById('timerForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const days = [];
            
            for (let i = 0; i < 7; i++) {
              days.push(document.getElementById('day' + i).checked);
            }
            
            const timerData = {
              relay: document.getElementById('timerRelay').value,
              action: document.getElementById('timerAction').value,
              startTime: document.getElementById('timerStartTime').value,
              endTime: document.getElementById('timerEndTime').value || null,
              days: days,
              active: true
            };
            
            try {
              const url = currentEditingTimerId ? '/timer/' + currentEditingTimerId : '/timer';
              const method = currentEditingTimerId ? 'PUT' : 'POST';
              
              const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(timerData)
              });
              
              if (response.ok) {
                closeTimerModal();
                location.reload();
              } else {
                alert('Error saving timer');
              }
            } catch (error) {
              alert('Error: ' + error.message);
            }
          });
          
          // Close modal when clicking outside
          window.onclick = function(event) {
            const modal = document.getElementById('timerModal');
            if (event.target === modal) {
              closeTimerModal();
            }
          }
        </script>
      </body>
    </html>
  `);
});

// API Routes

// Toggle relay
app.post('/relay', async (req, res) => {
  try {
    const { relay, state } = req.body;
    await set(ref(db, `relays/${relay}`), state);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get timer by ID
app.get('/timer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const snapshot = await get(ref(db, `timers/${id}`));
    if (snapshot.exists()) {
      res.json(snapshot.val());
    } else {
      res.status(404).json({ error: 'Timer not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create timer
app.post('/timer', async (req, res) => {
  try {
    const timerData = req.body;
    const newTimerRef = push(ref(db, 'timers'));
    await set(newTimerRef, timerData);
    res.json({ success: true, id: newTimerRef.key });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update timer
app.put('/timer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const timerData = req.body;
    await set(ref(db, `timers/${id}`), timerData);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete timer
app.delete('/timer/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await remove(ref(db, `timers/${id}`));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Timer Scheduler - Your existing logic remains unchanged
schedule.scheduleJob('*/1 * * * *', async () => {
  const now = moment().tz('Asia/Dubai');
  const currentDay = now.day() - 1;
  console.log('⏰ Checking timers at:', now.format('YYYY-MM-DD HH:mm:ss'));

  try {
    const snapshot = await get(ref(db, 'timers'));
    if (!snapshot.exists()) {
      console.log('❌ No timers found');
      latestNextTimer = null;
      return;
    }

    const timers = snapshot.val();
    const relaysToUpdate = {};
    let nextTimer = null;

    for (const [id, timer] of Object.entries(timers)) {
      if (!timer.active || !timer.days || !timer.days[currentDay]) continue;

      const start = moment.tz(`${now.format('YYYY-MM-DD')} ${timer.startTime}`, 'YYYY-MM-DD HH:mm', 'Asia/Dubai');
      const end = timer.endTime
        ? moment.tz(`${now.format('YYYY-MM-DD')} ${timer.endTime}`, 'YYYY-MM-DD HH:mm', 'Asia/Dubai')
        : null;
      if (end && end.isBefore(start)) end.add(1, 'day');

      if (now.isSameOrAfter(start) && (!end || now.isBefore(end))) {
        relaysToUpdate[timer.relay] = timer.action === 'ON';
        console.log(`✅ Timer ${id} setting ${timer.relay} to ${timer.action}`);
      } else if (end && now.isSameOrAfter(end)) {
        relaysToUpdate[timer.relay] = timer.action !== 'ON';
        console.log(`🔁 Timer ${id} ending — setting ${timer.relay} to ${timer.action === 'ON' ? 'OFF' : 'ON'}`);
      }

      if (start.isAfter(now)) {
        if (!nextTimer || start.isBefore(nextTimer.time)) {
          nextTimer = {
            id,
            time: start,
            relay: timer.relay,
            action: timer.action
          };
        }
      }
    }

    for (const [relay, state] of Object.entries(relaysToUpdate)) {
      await set(ref(db, `relays/${relay}`), state);
      console.log(`🔧 Updated ${relay} to ${state}`);
    }

    latestNextTimer = nextTimer;

    if (nextTimer) {
      console.log(
        `🕒 Next Timer: ${nextTimer.relay} will turn ${nextTimer.action} at ${nextTimer.time.format('HH:mm')} (Timer ID: ${nextTimer.id})`
      );
    } else {
      console.log('ℹ️ No upcoming timers for today.');
    }

  } catch (error) {
    console.error('❌ Timer check failed:', error);
    latestNextTimer = null;
  }
});

app.listen(port, () => {
  console.log(`✅ Server is live at http://localhost:${port}`);
});
