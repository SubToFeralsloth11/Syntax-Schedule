Syntax Schedule — Master Specification (Flat File Structure)
Overview

Syntax Schedule is a desktop scheduling application built with Electron using a simplified file structure. It allows users to create tasks, assign due dates, and receive system notifications at the correct time.

This version uses:

A single renderer (index.html)
A single frontend script (script.js)
A main Electron process (main.js)
Local JSON storage

No preload script is used in this version, so communication and structure are simplified.

Project Structure
syntax-schedule/
│
├── index.html        # UI
├── style.css         # Styling
├── script.js         # Frontend logic
├── main.js           # Electron backend
├── package.json      # Config
├── rules.md          # This file
│
├── tasks.json        # Created automatically (do not manually create)
Application Architecture
Main Process (main.js)

Responsible for:

Creating the app window
Handling notifications
Managing task storage
Running the scheduling loop
Renderer (index.html + script.js)

Responsible for:

UI rendering
User input
Sending task data to main process
Data Model

All tasks are stored in tasks.json.

Task Structure
{
  "id": "string",
  "title": "string",
  "description": "string",
  "dueDate": "ISO string",
  "notificationTime": "ISO string",
  "priority": "low | medium | high",
  "completed": false,
  "notified": false,
  "recurring": "none | daily | weekly | monthly"
}
Core Systems
1. Task Creation System

User must be able to:

Enter title
Enter description
Select due date/time
Select priority
Enable/disable notification
Choose recurring type

Validation rules:

Title is required
Date must be valid
Notification time must not be in the past
2. Task Storage System

Location:

tasks.json in root directory

Behavior:

If file does not exist → create it
Always store as array of tasks
Save immediately after any change

Required logic in main.js:

Read file
Write file
Add task
Delete task
Update task
3. Notification System

Runs inside main.js.

Uses:

Electron Notification

Trigger rules:

Current time >= notificationTime
Task.notified == false

After triggering:

Set notified = true
Save file
4. Scheduling Engine

Runs continuously in main.js.

Core loop:

Runs every 1000ms
Loads all tasks
Checks each task

Pseudo logic:

every second:
    currentTime = now

    for each task:
        if notify enabled AND not notified:
            if currentTime >= notificationTime:
                send notification
                mark as notified
5. Recurring System

When a recurring task triggers:

daily → add 1 day
weekly → add 7 days
monthly → add 1 month

Then:

update notificationTime
set notified = false
6. UI System (index.html)

Must include:

Input Form
Title input
Description input
Date/time picker
Priority dropdown
Recurring dropdown
Add button
Task List
Display all tasks
Show:
Title
Due date
Priority
Status
Actions
Delete task
Mark complete
7. Frontend Logic (script.js)

Responsibilities:

Capture form input
Send task data to main process
Render task list
Update UI on changes
8. Communication Method

Since no preload is used, you will use:

window.require("electron") inside script.js

Example:

const { ipcRenderer } = window.require("electron");
9. IPC Events

Renderer → Main:

"add-task"
"delete-task"
"get-tasks"

Main → Renderer:

"tasks-updated"
10. App Lifecycle

On startup:

Launch Electron
Open window
Load tasks.json
Start scheduler loop
11. Error Handling

Must handle:

Missing tasks.json
Invalid JSON
Empty inputs
Invalid dates

Fallback:

If JSON fails → reset to empty array
UI Behavior Rules
Completed tasks appear faded or crossed out
High priority tasks visually distinct
Tasks sorted by due date
Real-time updates after changes
package.json Requirements

Must include:

main entry → main.js
start script → electron .
Master Prompt (Updated for Your Setup)

Use this for AI generation:

Create a full Electron desktop app called "Syntax Schedule" using a flat file structure.

Files:
- index.html
- style.css
- script.js
- main.js
- package.json

Do NOT use preload.js or separate renderer folders.

The app must:
- allow users to create tasks with title, description, due date, notification time, priority, and recurring options
- store all tasks in a local tasks.json file
- display tasks in the UI
- allow deleting and completing tasks
- run a background scheduler in main.js that checks every second
- send system notifications when tasks are due
- support recurring reminders (daily, weekly, monthly)
- prevent duplicate notifications using a notified flag
- use ipcRenderer and ipcMain for communication

Do not skip any system. Fully implement everything.