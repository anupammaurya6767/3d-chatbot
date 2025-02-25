import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// Add CSS for video preview
const style = document.createElement('style');
style.textContent = `
    #video-preview {
        position: fixed;
        top: 20px;
        right: 800px;
        width: 320px;
        height: 240px;
        border: 2px solid #4285F4;
        border-radius: 8px;
        z-index: 1000;
        background: #000;
    }
`;
document.head.appendChild(style);

// Add video preview element
const videoPreview = document.createElement('video');
videoPreview.id = 'video-preview';
videoPreview.autoplay = true;
videoPreview.muted = true; // Prevent audio feedback
document.body.appendChild(videoPreview);
// Template definitions
const questionTemplates = {
    personal: {
        name: "Personal Interview",
        questions: [
            "What is your name?",
            "What is your age?",
            "How are you feeling today?",
            "What's your favorite color?",
            "Tell me about your hobbies."
        ]
    },
    professional: {
        name: "Professional Interview",
        questions: [
            "What is your professional background?",
            "Describe your ideal work environment",
            "What are your career goals?",
            "What's your greatest professional achievement?",
            "How do you handle workplace challenges?"
        ]
    },
    educational: {
        name: "Educational Interview",
        questions: [
            "What is your educational background?",
            "What subjects interest you most?",
            "Describe your learning style",
            "What are your academic goals?",
            "How do you approach studying?"
        ]
    },
    custom: {
        name: "Custom Template",
        questions: [] // Will be populated dynamically
    }
};

// State management
let scene, camera, renderer, jarvis, controls;
let clock = new THREE.Clock();
let currentTemplate = null;
let userUniqueId = null;
let timerInterval;
let remainingTime = 30;
let isAnswering = false;
let isPaused = false;
let currentAnswer = '';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = true;
recognition.interimResults = false;

const synth = window.speechSynthesis;

let mediaStream;
let mediaRecorder;
let recordedChunks = [];

let currentQuestionIndex = 0;
let userAnswers = [];
let answerVideos = {};

let chatbotState = {
    mood: 'neutral',
    color: 0x4285F4,
};

let isListening = false;

// Generate unique ID for users
function generateUniqueId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Initialize template selector
function initializeTemplateSelector() {
    const selector = document.createElement('select');
    selector.id = 'template-selector';
    selector.innerHTML = `
        <option value="">Select Interview Template</option>
        ${Object.entries(questionTemplates).map(([key, template]) => 
            `<option value="${key}">${template.name}</option>`
        ).join('')}
    `;
    
    selector.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
            promptForCustomTemplate();
        } else if (e.target.value) {
            currentTemplate = questionTemplates[e.target.value];
            initializeNewInterview();
        }
    });
    
    document.getElementById('template-container').appendChild(selector);
}

function promptForCustomTemplate() {
    const questionsCount = prompt("How many questions would you like in your template?");
    const count = parseInt(questionsCount);
    
    if (count && count > 0) {
        const questions = [];
        for (let i = 0; i < count; i++) {
            const question = prompt(`Enter question ${i + 1}:`);
            if (question) questions.push(question);
        }
        
        if (questions.length > 0) {
            questionTemplates.custom.questions = questions;
            currentTemplate = questionTemplates.custom;
            initializeNewInterview();
        }
    }
}

function initializeNewInterview() {
    userUniqueId = generateUniqueId();
    const shareableLink = generateShareableLink();
    document.getElementById('shareable-link').textContent = 
        `Your unique interview link: ${shareableLink}`;
    startInterview();
}

function generateShareableLink() {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?interview=${userUniqueId}`;
}

function startInterview() {
    currentQuestionIndex = 0;
    userAnswers = [];
    answerVideos = {};
    document.getElementById('chat-container').style.display = 'block';
    displayQuestion();
}

function displayQuestion() {
    const questionDisplay = document.getElementById('question-display');
    if (currentTemplate && currentQuestionIndex < currentTemplate.questions.length) {
        questionDisplay.textContent = currentTemplate.questions[currentQuestionIndex];
        
        // Add timer display
        const timerDisplay = document.createElement('div');
        timerDisplay.id = 'timer-display';
        timerDisplay.style.fontSize = '1.2em';
        timerDisplay.style.marginTop = '10px';
        questionDisplay.appendChild(timerDisplay);

        // Hide next button initially
        document.getElementById('nextButton').style.display = 'none';
        document.getElementById('listenButton').style.display = 'inline-block';
        document.getElementById('micButton').style.display = 'none';
        
        // Automatically read the question
        setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(
                currentTemplate.questions[currentQuestionIndex]
            );
            utterance.onend = () => {
                // Start recording after question is read
                startAnswering();
            };
            synth.speak(utterance);
        }, 1000);
    } else {
        showSummary();
    }
}

function startAnswering() {
    isAnswering = true;
    isPaused = false;
    remainingTime = 30;
    startTimer();
    startListening();
    
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'answer-controls';
    controlsContainer.className = 'controls-container';
    
    // Create pause/resume button
    const pauseButton = document.createElement('button');
    pauseButton.id = 'pauseButton';
    pauseButton.className = 'control-button';
    pauseButton.textContent = 'Pause';
    pauseButton.onclick = togglePause;
    
    // Create submit button
    const submitButton = document.createElement('button');
    submitButton.id = 'submitButton';
    submitButton.className = 'control-button';
    submitButton.textContent = 'Submit Answer';
    submitButton.onclick = submitAnswer;
    
    // Create restart button
    const restartButton = document.createElement('button');
    restartButton.id = 'restartButton';
    restartButton.className = 'control-button';
    restartButton.textContent = 'Restart Answer';
    restartButton.onclick = restartAnswer;
    restartButton.style.display = 'none';
    
    controlsContainer.appendChild(pauseButton);
    controlsContainer.appendChild(submitButton);
    controlsContainer.appendChild(restartButton);
    
    document.getElementById('chat-container').appendChild(controlsContainer);
    document.getElementById('micButton').style.display = 'inline-block';
}

function togglePause() {
    isPaused = !isPaused;
    const pauseButton = document.getElementById('pauseButton');
    const restartButton = document.getElementById('restartButton');
    
    if (isPaused) {
        pauseButton.textContent = 'Resume';
        clearInterval(timerInterval);
        stopListening();
        currentAnswer = userAnswers[currentQuestionIndex] || '';
        restartButton.style.display = 'inline-block';
    } else {
        pauseButton.textContent = 'Pause';
        startTimer();
        startListening();
        restartButton.style.display = 'none';
    }
}

function restartAnswer() {
    if (confirm('Are you sure you want to restart your answer? Current answer will be deleted.')) {
        remainingTime = 30;
        userAnswers[currentQuestionIndex] = '';
        currentAnswer = '';
        recordedChunks = [];
        if (answerVideos[currentQuestionIndex]) {
            delete answerVideos[currentQuestionIndex];
        }
        
        // Reset UI
        const pauseButton = document.getElementById('pauseButton');
        pauseButton.textContent = 'Pause';
        document.getElementById('restartButton').style.display = 'none';
        
        // Restart recording
        isPaused = false;
        startTimer();
        startListening();
    }
}

function startTimer() {
    const timerDisplay = document.getElementById('timer-display');
    
    updateTimerDisplay();
    
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    timerInterval = setInterval(() => {
        if (!isPaused) {
            remainingTime--;
            updateTimerDisplay();
            
            if (remainingTime <= 0) {
                submitAnswer();
            }
        }
    }, 1000);
}

function updateTimerDisplay() {
    const timerDisplay = document.getElementById('timer-display');
    timerDisplay.textContent = `Time remaining: ${remainingTime} seconds`;
}

function submitAnswer() {
    clearInterval(timerInterval);
    stopListening();
    isAnswering = false;
    isPaused = false;
    
    // Remove control buttons
    const controlsContainer = document.getElementById('answer-controls');
    if (controlsContainer) {
        controlsContainer.remove();
    }
    
    // Show next button
    document.getElementById('nextButton').style.display = 'inline-block';
}

function createJarvis() {
    const group = new THREE.Group();

    // Body
    const bodyGeometry = new THREE.CylinderGeometry(0.5, 0.3, 1.5, 20);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: chatbotState.color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    group.add(body);

    // Head
    const headGeometry = new THREE.SphereGeometry(0.3, 32, 32);
    const headMaterial = new THREE.MeshPhongMaterial({ color: chatbotState.color });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1;
    group.add(head);

    // Eyes
    const eyeGeometry = new THREE.SphereGeometry(0.05, 32, 32);
    const eyeMaterial = new THREE.MeshPhongMaterial({ color: 0xFFFFFF });
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.1, 1, 0.25);
    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.1, 1, 0.25);
    group.add(leftEye, rightEye);

    return group;
}

function initThreeJS() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0xf0f0f0);
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 10, 5);
    scene.add(directionalLight);

    jarvis = createJarvis();
    // scene.add(jarvis);

    camera.position.z = 5;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    if (chatbotState.mood === 'happy') {
        jarvis.rotation.y += delta * 2;
    } else if (chatbotState.mood === 'sad') {
        jarvis.rotation.x = Math.sin(clock.getElapsedTime() * 2) * 0.1;
    } else {
        jarvis.rotation.y += delta * 0.5;
    }
    
    if (controls) controls.update();
    
    renderer.render(scene, camera);
}

function updateChatbotState(transcript) {
    if (transcript.toLowerCase().includes('happy') || transcript.toLowerCase().includes('good')) {
        chatbotState.mood = 'happy';
    } else if (transcript.toLowerCase().includes('sad') || transcript.toLowerCase().includes('bad')) {
        chatbotState.mood = 'sad';
    } else {
        chatbotState.mood = 'neutral';
    }

    const colorMap = {
        'red': 0xFF0000,
        'green': 0x00FF00,
        'blue': 0x0000FF,
        'yellow': 0xFFFF00,
        'purple': 0x800080,
        'orange': 0xFFA500
    };

    for (let color in colorMap) {
        if (transcript.toLowerCase().includes(color)) {
            chatbotState.color = colorMap[color];
            updateJarvisColor(chatbotState.color);
            break;
        }
    }
}

function updateJarvisColor(color) {
    jarvis.traverse((child) => {
        if (child.isMesh && child.material.color) {
            child.material.color.setHex(color);
        }
    });
}

async function setupMediaStream() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        console.log('Media permissions granted');
        
        // Connect media stream to video preview
        videoPreview.srcObject = mediaStream;
        
        initializeSpeechRecognition();
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Please allow access to your camera and microphone to use this application.');
    }
}

function initializeSpeechRecognition() {
    recognition.start();
    console.log('Speech recognition initialized');
    
    recognition.onresult = (event) => {
        if (isListening && !isPaused) {
            const transcript = event.results[event.results.length - 1][0].transcript;
            console.log('User said:', transcript);
            userAnswers[currentQuestionIndex] = currentAnswer + ' ' + transcript;
            updateChatbotState(transcript);
        }
    };

    recognition.onend = () => {
        if (isListening && !isPaused) {
            recognition.start();
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        stopListening();
    };
}

function startListening() {
    if (!isListening && mediaStream && !isPaused) {
        isListening = true;
        document.getElementById('micButton').textContent = 'Listening to your answer';
        document.getElementById('micButton').classList.add('listening');
        startRecording();
    } else if (!mediaStream) {
        console.error('Media stream not available. Please refresh the page.');
    }
}

function stopListening() {
    if (isListening) {
        isListening = false;
        document.getElementById('micButton').textContent = 'Answer the question';
        document.getElementById('micButton').classList.remove('listening');
        stopRecording();
    }
}

function startRecording() {
    if (mediaStream && !isPaused) {
        mediaRecorder = new MediaRecorder(mediaStream);
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        mediaRecorder.start();
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        setTimeout(() => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            answerVideos[currentQuestionIndex] = blob;
            recordedChunks = [];
        }, 100);
    }
}

function showSummary() {
    const summaryDiv = document.getElementById('summary');
    summaryDiv.innerHTML = `
        <h2>Summary of Your ${currentTemplate.name}</h2>
        <p>Interview ID: ${userUniqueId}</p>
    `;
    
    for (let i = 0; i < currentTemplate.questions.length; i++) {
        summaryDiv.innerHTML += `
            <p><strong>${currentTemplate.questions[i]}</strong> 
            ${userAnswers[i] || 'No answer provided'}</p>
        `;
    }
    
    summaryDiv.style.display = 'block';
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('downloadButton').style.display = 'block';
}

async function createZipFile() {
    const zip = new JSZip();
    const userFolder = zip.folder(userUniqueId);
    const answersFolder = userFolder.folder("answers");

    // Save template information
    userFolder.file("interview_info.json", JSON.stringify({
        templateName: currentTemplate.name,
        interviewId: userUniqueId,
        timestamp: new Date().toISOString(),
        templateQuestions: currentTemplate.questions
    }));

    // Save each question and answer
    for (let i = 0; i < currentTemplate.questions.length; i++) {
        const questionFolder = answersFolder.folder(`Question_${i + 1}`);
        
        // Save question text
        questionFolder.file("question.txt", currentTemplate.questions[i]);
        
        // Save answer text
        questionFolder.file("answer_text.txt", userAnswers[i] || "No answer provided");
        
        // Save video if available
        if (answerVideos[i]) {
            questionFolder.file(`answer_video.webm`, answerVideos[i]);
        }
    }

    // Save summary
    answersFolder.file("summary.txt", document.getElementById('summary').innerText);

    try {
        const content = await zip.generateAsync({type: "blob"});
        saveAs(content, `${userUniqueId}_interview.zip`);
    } catch (error) {
        console.error('Error creating zip file:', error);
        alert('There was an error creating your download. Please try again.');
    }
}

function checkForExistingInterview() {
    const urlParams = new URLSearchParams(window.location.search);
    const interviewId = urlParams.get('interview');
    
    if (interviewId) {
        userUniqueId = interviewId;
        document.getElementById('shareable-link').textContent = 
            `Viewing interview: ${interviewId}`;
            
        // Here you would typically fetch the existing interview data from a server
        // For now, we'll just show a message
        alert('Note: To fully implement interview loading, you would need to set up server-side storage.');
    }
}

// Event listeners
document.getElementById('micButton').addEventListener('click', () => {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
});

document.getElementById('listenButton').addEventListener('click', () => {
    if (currentTemplate) {
        // Stop any ongoing speech
        synth.cancel();
        
        const utterance = new SpeechSynthesisUtterance(
            currentTemplate.questions[currentQuestionIndex]
        );
        synth.speak(utterance);
    }
});

document.getElementById('nextButton').addEventListener('click', () => {
    stopListening();
    clearInterval(timerInterval);
    currentQuestionIndex++;
    if (currentTemplate && currentQuestionIndex < currentTemplate.questions.length) {
        displayQuestion();
    } else {
        showSummary();
    }
});

document.getElementById('downloadButton').addEventListener('click', createZipFile);

// Error handling for speech synthesis
synth.onerror = (event) => {
    console.error('Speech synthesis error:', event);
    alert('There was an error with the text-to-speech system. Please try again.');
};

// Initialize everything
async function init() {
    try {
        await setupMediaStream();
        initThreeJS();
        animate();
        initializeTemplateSelector();
        checkForExistingInterview();
    } catch (error) {
        console.error('Initialization error:', error);
        alert('There was an error initializing the application. Please refresh the page and try again.');
    }
}

// Start the application
init();

// Handle page unload
window.addEventListener('beforeunload', (event) => {
    clearInterval(timerInterval);
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    if (recognition) {
        recognition.stop();
    }
    if (videoPreview.srcObject) {
        videoPreview.srcObject = null;
    }
});

// Export for potential module usage
export {
    questionTemplates,
    startInterview,
    createZipFile,
    generateUniqueId
};