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

// Language options
const languages = {
    en: 'English',
    hi: 'Hindi'
};

// Template definitions with questions in multiple languages
const questionTemplates = {
    personal: {
        name: "Personal Interview",
        questions: {
            en: [
                "What is your name?",
                "What is your age?",
                "How are you feeling today?",
                "What's your favorite color?",
                "Tell me about your hobbies."
            ],
            hi: [
                "आपका नाम क्या है?",
                "आपकी उम्र क्या है?",
                "आज आप कैसा महसूस कर रहे हैं?",
                "आपका पसंदीदा रंग क्या है?",
                "अपने शौक के बारे में बताएं।"
            ]
        }
    },
    professional: {
        name: "Professional Interview",
        questions: {
            en: [
                "What is your professional background?",
                "Describe your ideal work environment",
                "What are your career goals?",
                "What's your greatest professional achievement?",
                "How do you handle workplace challenges?"
            ],
            hi: [
                "आपका पेशेवर पृष्ठभूमि क्या है?",
                "अपने आदर्श कार्य वातावरण का वर्णन करें",
                "आपके करियर के लक्ष्य क्या हैं?",
                "आपकी सबसे बड़ी पेशेवर उपलब्धि क्या है?",
                "आप कार्यस्थल की चुनौतियों को कैसे संभालते हैं?"
            ]
        }
    },
    educational: {
        name: "Educational Interview",
        questions: {
            en: [
                "What is your educational background?",
                "What subjects interest you most?",
                "Describe your learning style",
                "What are your academic goals?",
                "How do you approach studying?"
            ],
            hi: [
                "आपकी शैक्षिक पृष्ठभूमि क्या है?",
                "आपको सबसे अधिक रुचि वाले विषय क्या हैं?",
                "अपनी सीखने की शैली का वर्णन करें",
                "आपके शैक्षिक लक्ष्य क्या हैं?",
                "आप अध्ययन के लिए कैसे तैयारी करते हैं?"
            ]
        }
    },
    custom: {
        name: "Custom Template",
        questions: {} // Will be populated dynamically for each language
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
let selectedLanguage = null; // User must select a language

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

// Initialize language and template selectors
function initializeTemplateSelector() {
    const languageSelector = document.createElement('select');
    languageSelector.id = 'language-selector';
    languageSelector.innerHTML = `
        <option value="">Select Language</option>
        ${Object.entries(languages).map(([key, name]) => 
            `<option value="${key}">${name}</option>`
        ).join('')}
    `;
    
    languageSelector.addEventListener('change', (e) => {
        selectedLanguage = e.target.value;
    });
    
    const templateSelector = document.createElement('select');
    templateSelector.id = 'template-selector';
    templateSelector.innerHTML = `
        <option value="">Select Interview Template</option>
        ${Object.entries(questionTemplates).map(([key, template]) => 
            `<option value="${key}">${template.name}</option>`
        ).join('')}
    `;
    
    templateSelector.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
            promptForCustomTemplate();
        } else if (e.target.value) {
            currentTemplate = questionTemplates[e.target.value];
            initializeNewInterview();
        }
    });
    
    const container = document.getElementById('template-container');
    container.appendChild(languageSelector);
    container.appendChild(templateSelector);
}

function promptForCustomTemplate() {
    if (!selectedLanguage) {
        alert('Please select a language first.');
        return;
    }
    const questionsCount = prompt("How many questions would you like in your template?");
    const count = parseInt(questionsCount);
    
    if (count && count > 0) {
        const questions = [];
        for (let i = 0; i < count; i++) {
            const question = prompt(`Enter question ${i + 1} (in ${languages[selectedLanguage]}):`);
            if (question) questions.push(question);
        }
        
        if (questions.length > 0) {
            questionTemplates.custom.questions[selectedLanguage] = questions;
            currentTemplate = questionTemplates.custom;
            initializeNewInterview();
        }
    }
}

function initializeNewInterview() {
    if (!selectedLanguage) {
        alert('Please select a language first.');
        return;
    }
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
    if (currentTemplate && currentQuestionIndex < currentTemplate.questions[selectedLanguage].length) {
        questionDisplay.textContent = currentTemplate.questions[selectedLanguage][currentQuestionIndex];
        
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
                currentTemplate.questions[selectedLanguage][currentQuestionIndex]
            );
            utterance.lang = selectedLanguage === 'hi' ? 'hi-IN' : 'en-US';
            const voices = synth.getVoices();
            const langVoices = voices.filter(voice => voice.lang === (selectedLanguage === 'hi' ? 'hi-IN' : 'en-US'));
            if (langVoices.length > 0) {
                utterance.voice = langVoices[0];
            }
            utterance.onend = () => {
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
    
    const pauseButton = document.createElement('button');
    pauseButton.id = 'pauseButton';
    pauseButton.className = 'control-button';
    pauseButton.textContent = 'Pause';
    pauseButton.onclick = togglePause;
    
    const submitButton = document.createElement('button');
    submitButton.id = 'submitButton';
    submitButton.className = 'control-button';
    submitButton.textContent = 'Submit Answer';
    submitButton.onclick = submitAnswer;
    
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
        
        const pauseButton = document.getElementById('pauseButton');
        pauseButton.textContent = 'Pause';
        document.getElementById('restartButton').style.display = 'none';
        
        isPaused = false;
        startTimer();
        startListening();
    }
}

function startTimer() {
    const timerDisplay = document.getElementById('timer-display');
    updateTimerDisplay();
    
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        if (!isPaused) {
            remainingTime--;
            updateTimerDisplay();
            if (remainingTime <= 0) submitAnswer();
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
    
    const controlsContainer = document.getElementById('answer-controls');
    if (controlsContainer) controlsContainer.remove();
    
    document.getElementById('nextButton').style.display = 'inline-block';
}

function createJarvis() {
    const group = new THREE.Group();
    const bodyGeometry = new THREE.CylinderGeometry(0.5, 0.3, 1.5, 20);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: chatbotState.color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    group.add(body);

    const headGeometry = new THREE.SphereGeometry(0.3, 32, 32);
    const headMaterial = new THREE.MeshPhongMaterial({ color: chatbotState.color });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1;
    group.add(head);

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
    const lowerTranscript = transcript.toLowerCase();
    if (lowerTranscript.includes('happy') || lowerTranscript.includes('good')) {
        chatbotState.mood = 'happy';
    } else if (lowerTranscript.includes('sad') || lowerTranscript.includes('bad')) {
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
        if (lowerTranscript.includes(color)) {
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
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('Media permissions granted');
        videoPreview.srcObject = mediaStream;
        initializeSpeechRecognition();
    } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Please allow access to your camera and microphone to use this application.');
    }
}

function initializeSpeechRecognition() {
    recognition.lang = selectedLanguage === 'hi' ? 'hi-IN' : 'en-US';
    recognition.start();
    console.log('Speech recognition initialized with language:', recognition.lang);
    
    recognition.onresult = (event) => {
        if (isListening && !isPaused) {
            const transcript = event.results[event.results.length - 1][0].transcript;
            console.log('User said:', transcript);
            userAnswers[currentQuestionIndex] = (currentAnswer + ' ' + transcript).trim();
            updateChatbotState(transcript);
        }
    };

    recognition.onend = () => {
        if (isListening && !isPaused) recognition.start();
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
            if (event.data.size > 0) recordedChunks.push(event.data);
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
    
    for (let i = 0; i < currentTemplate.questions[selectedLanguage].length; i++) {
        summaryDiv.innerHTML += `
            <p><strong>${currentTemplate.questions[selectedLanguage][i]}</strong> 
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

    userFolder.file("interview_info.json", JSON.stringify({
        templateName: currentTemplate.name,
        interviewId: userUniqueId,
        timestamp: new Date().toISOString(),
        templateQuestions: currentTemplate.questions[selectedLanguage],
        language: selectedLanguage
    }));

    for (let i = 0; i < currentTemplate.questions[selectedLanguage].length; i++) {
        const questionFolder = answersFolder.folder(`Question_${i + 1}`);
        questionFolder.file("question.txt", currentTemplate.questions[selectedLanguage][i]);
        questionFolder.file("answer_text.txt", userAnswers[i] || "No answer provided");
        if (answerVideos[i]) {
            questionFolder.file(`answer_video.webm`, answerVideos[i]);
        }
    }

    answersFolder.file("summary.txt", document.getElementById('summary').innerText);

    try {
        const content = await zip.generateAsync({ type: "blob" });
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
        alert('Note: To fully implement interview loading, you would need to set up server-side storage.');
    }
}

// Event listeners
document.getElementById('micButton').addEventListener('click', () => {
    if (isListening) stopListening();
    else startListening();
});

document.getElementById('listenButton').addEventListener('click', () => {
    if (currentTemplate) {
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(
            currentTemplate.questions[selectedLanguage][currentQuestionIndex]
        );
        utterance.lang = selectedLanguage === 'hi' ? 'hi-IN' : 'en-US';
        const voices = synth.getVoices();
        const langVoices = voices.filter(voice => voice.lang === (selectedLanguage === 'hi' ? 'hi-IN' : 'en-US'));
        if (langVoices.length > 0) utterance.voice = langVoices[0];
        synth.speak(utterance);
    }
});

document.getElementById('nextButton').addEventListener('click', () => {
    stopListening();
    clearInterval(timerInterval);
    currentQuestionIndex++;
    if (currentTemplate && currentQuestionIndex < currentTemplate.questions[selectedLanguage].length) {
        displayQuestion();
    } else {
        showSummary();
    }
});

document.getElementById('downloadButton').addEventListener('click', createZipFile);

synth.onerror = (event) => {
    console.error('Speech synthesis error:', event);
    alert('There was an error with the text-to-speech system. Please try again.');
};

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

init();

window.addEventListener('beforeunload', () => {
    clearInterval(timerInterval);
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    if (recognition) recognition.stop();
    if (videoPreview.srcObject) videoPreview.srcObject = null;
});

export { questionTemplates, startInterview, createZipFile, generateUniqueId };