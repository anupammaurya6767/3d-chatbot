import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

let scene, camera, renderer, jarvis, controls;
let clock = new THREE.Clock();

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = true;
recognition.interimResults = false;

const synth = window.speechSynthesis;

let mediaStream;
let mediaRecorder;
let recordedChunks = [];

const questions = [
    "What is your name?",
    "What is your age?",
    "How are you feeling today?",
    "What's your favorite color?",
    "Tell me about your hobbies."
];

let currentQuestionIndex = 0;
let userAnswers = [];
let answerVideos = {};

let chatbotState = {
    mood: 'neutral',
    color: 0x4285F4, // Google Blue
};

let isListening = false;

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
    renderer.setClearColor(0xf0f0f0); // Light grey background
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0, 10, 5);
    scene.add(directionalLight);

    // Create and add Jarvis
    jarvis = createJarvis();
    scene.add(jarvis);

    camera.position.z = 5;

    // Add OrbitControls
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
    
    // Simple animation based on mood
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

    if (currentQuestionIndex === 3) { // Favorite color question
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
        initializeSpeechRecognition();
    } catch (error) {
        console.error('Error accessing media devices:', error);
        // Handle the error, maybe show a message to the user
    }
}
function initializeSpeechRecognition() {
    recognition.start();
    console.log('Speech recognition initialized');
    
    recognition.onresult = (event) => {
        if (isListening) {
            const transcript = event.results[event.results.length - 1][0].transcript;
            console.log('User said:', transcript);
            userAnswers[currentQuestionIndex] = transcript;
            updateChatbotState(transcript);
            document.getElementById('nextButton').style.display = 'inline-block';
            stopListening();
        }
    };

    recognition.onend = () => {
        recognition.start(); // Restart recognition to keep it continuous
    };
}

function startListening() {
    if (!isListening && mediaStream) {
        isListening = true;
        document.getElementById('micButton').textContent = 'Listening...';
        document.getElementById('micButton').classList.add('listening');
        startRecording();
    } else if (!mediaStream) {
        console.error('Media stream not available. Please refresh the page.');
    }
}

function stopListening() {
    if (isListening) {
        isListening = false;
        document.getElementById('micButton').textContent = 'Start Listening';
        document.getElementById('micButton').classList.remove('listening');
        stopRecording();
    }
}

function startRecording() {
    if (mediaStream) {
        mediaRecorder = new MediaRecorder(mediaStream);
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        mediaRecorder.start();
    } else {
        console.error('Media stream not available');
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

function displayQuestion() {
    const questionDisplay = document.getElementById('question-display');
    if (currentQuestionIndex < questions.length) {
        questionDisplay.textContent = questions[currentQuestionIndex];
        document.getElementById('listenButton').style.display = 'inline-block';
        document.getElementById('micButton').style.display = 'inline-block';
        document.getElementById('nextButton').style.display = 'none';
    } else {
        showSummary();
    }
}

function showSummary() {
    const summaryDiv = document.getElementById('summary');
    summaryDiv.innerHTML = '<h2>Summary of Your Answers:</h2>';
    
    for (let i = 0; i < questions.length; i++) {
        summaryDiv.innerHTML += `<p><strong>${questions[i]}</strong> ${userAnswers[i] || 'No answer provided'}</p>`;
    }
    
    summaryDiv.style.display = 'block';
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('downloadButton').style.display = 'block';
}

function speakQuestion() {
    const utterance = new SpeechSynthesisUtterance(questions[currentQuestionIndex]);
    synth.speak(utterance);
}

function createZipFile() {
    const zip = new JSZip();
    const answersFolder = zip.folder("answer_provided");

    for (let i = 0; i < questions.length; i++) {
        const questionFolder = answersFolder.folder(`Question_${i + 1}`);
        if (answerVideos[i]) {
            questionFolder.file(`answer_video.webm`, answerVideos[i]);
        }
        questionFolder.file("answer_text.txt", userAnswers[i] || "No answer provided");
    }

    answersFolder.file("summary.txt", document.getElementById('summary').innerText);

    zip.generateAsync({type:"blob"})
        .then(function(content) {
            saveAs(content, "answer_provided.zip");
        });
}

// Event listeners
document.getElementById('micButton').addEventListener('click', () => {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
});

document.getElementById('listenButton').addEventListener('click', speakQuestion);

document.getElementById('nextButton').addEventListener('click', () => {
    stopListening();
    currentQuestionIndex++;
    if (currentQuestionIndex < questions.length) {
        displayQuestion();
    } else {
        showSummary();
    }
});

document.getElementById('downloadButton').addEventListener('click', createZipFile);

// Initialize everything
async function init() {
    try {
        await setupMediaStream();
        initThreeJS();
        animate();
        displayQuestion();
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

init();