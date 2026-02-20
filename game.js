// How to run: Open index.html directly in a web browser. No server required.
// Desktop: WASD/Arrows = move, Mouse = aim, LMB/Space = shoot, Shift = dash, P/Esc = pause, R = restart, M = mute, ~ = debug
// Mobile: Left thumb = joystick move, Right thumb = aim+shoot, Dash button, Pause/Mute buttons

(function() {
    'use strict';

    // Canvas setup
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }
    const ctx = canvas.getContext('2d');
    let dpr = window.devicePixelRatio || 1;
    
    // Canvas sizing with devicePixelRatio
    function resizeCanvas() {
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = cssHeight + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();
    window.addEventListener('resize', () => {
        resizeCanvas();
        updateJoystickBaseMetrics();
    });

    // Game state
    let gameState = 'playing'; // 'playing', 'paused', 'gameOver'
    let paused = false;
    let muted = false;
    let debug = false;
    let score = 0;
    let wave = 1;
    let screenShake = { x: 0, y: 0 };
    let shakeDecay = 0.92;
    let hitstop = 0;
    
    // Combo system
    let combo = 0;
    let comboTimer = 0;
    let comboResetTime = 2;

    // Input state
    const keys = {};
    const mouse = { x: 0, y: 0, down: false, worldX: 0, worldY: 0 };
    
    // Mobile touch controls
    let isMobile = false;
    let touchJoystick = { active: false, centerX: 0, centerY: 0, x: 0, y: 0, radius: 60 };
    let touchAim = { active: false, x: 0, y: 0 };
    let mobileMoveInput = { x: 0, y: 0 };
    let mobileMoveTarget = { x: 0, y: 0 };
    let leftTouchId = null;
    let rightTouchId = null;
    const joystickDeadzone = 0.15;
    const joystickLerp = 0.2;
    
    // Sound spam limiter
    let soundTimestamps = [];
    const maxSoundsPerSecond = 20;
    
    // Input handlers
    window.addEventListener('keydown', (e) => {
        keys[e.key.toLowerCase()] = true;
        if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
            paused = !paused;
            gameState = paused ? 'paused' : 'playing';
        }
        if (e.key === 'r' || e.key === 'R') {
            restart();
        }
        if (e.key === 'm' || e.key === 'M') {
            muted = !muted;
        }
        if (e.key === '~' || e.key === '`') {
            debug = !debug;
        }
    });
    
    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });
    
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
        mouse.worldX = mouse.x;
        mouse.worldY = mouse.y;
    });
    
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) mouse.down = true;
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (e.button === 0) mouse.down = false;
    });
    
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Mobile touch controls setup
    const joystickBase = document.getElementById('joystickBase');
    const joystickKnob = document.getElementById('joystickKnob');
    const dashButton = document.getElementById('dashButton');
    const pauseButton = document.getElementById('pauseButton');
    const muteButton = document.getElementById('muteButton');
    const mobileControls = document.getElementById('mobileControls');
    const audioHint = document.getElementById('audioHint');

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function updateJoystickBaseMetrics() {
        if (!joystickBase || !joystickKnob) return;
        const baseRect = joystickBase.getBoundingClientRect();
        if (baseRect.width === 0 || baseRect.height === 0) return;
        const canvasRect = canvas.getBoundingClientRect();
        touchJoystick.centerX = baseRect.left - canvasRect.left + baseRect.width / 2;
        touchJoystick.centerY = baseRect.top - canvasRect.top + baseRect.height / 2;
        touchJoystick.radius = baseRect.width / 2;
        resetJoystickKnob();
    }

    function setJoystickKnob(x, y) {
        const canvasHeight = canvas.height / dpr;
        joystickKnob.style.left = `${x}px`;
        joystickKnob.style.bottom = `${canvasHeight - y}px`;
    }

    function resetJoystickKnob() {
        setJoystickKnob(touchJoystick.centerX, touchJoystick.centerY);
    }
    
    // Detect mobile
    function detectMobile() {
        isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                   ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        if (isMobile) {
            mobileControls.classList.add('active');
            audioHint.classList.add('show');
            updateJoystickBaseMetrics();
        }
    }
    detectMobile();
    
    // Touch event handlers
    function handleTouchStart(e) {
        e.preventDefault();
        initAudio();
        resumeAudio();

        const rect = canvas.getBoundingClientRect();
        const halfWidth = canvas.width / (2 * dpr);

        for (const touch of e.changedTouches) {
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            if (x < halfWidth && leftTouchId === null) {
                leftTouchId = touch.identifier;
                touchJoystick.active = true;
                touchJoystick.x = 0;
                touchJoystick.y = 0;
                mobileMoveTarget.x = 0;
                mobileMoveTarget.y = 0;
                if (touchJoystick.centerX === 0 && touchJoystick.centerY === 0) {
                    updateJoystickBaseMetrics();
                }
                resetJoystickKnob();
            } else if (x >= halfWidth && rightTouchId === null) {
                rightTouchId = touch.identifier;
                touchAim.active = true;
                touchAim.x = x;
                touchAim.y = y;
                mouse.worldX = x;
                mouse.worldY = y;
                mouse.down = true;
            }
        }
    }
    
    function handleTouchMove(e) {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();

        for (const touch of e.changedTouches) {
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            if (touch.identifier === leftTouchId && touchJoystick.active) {
                const dx = x - touchJoystick.centerX;
                const dy = y - touchJoystick.centerY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxDist = touchJoystick.radius;

                if (dist > 0) {
                    const clampedDist = Math.min(dist, maxDist);
                    const clampedX = (dx / dist) * clampedDist;
                    const clampedY = (dy / dist) * clampedDist;
                    setJoystickKnob(touchJoystick.centerX + clampedX, touchJoystick.centerY + clampedY);

                    const normalized = clampedDist / maxDist;
                    const strength = normalized <= joystickDeadzone
                        ? 0
                        : (normalized - joystickDeadzone) / (1 - joystickDeadzone);
                    touchJoystick.x = (dx / dist) * strength;
                    touchJoystick.y = (dy / dist) * strength;
                } else {
                    touchJoystick.x = 0;
                    touchJoystick.y = 0;
                    resetJoystickKnob();
                }

                mobileMoveTarget.x = touchJoystick.x;
                mobileMoveTarget.y = touchJoystick.y;
            }

            if (touch.identifier === rightTouchId && touchAim.active) {
                touchAim.x = x;
                touchAim.y = y;
                mouse.worldX = x;
                mouse.worldY = y;
            }
        }
    }
    
    function handleTouchEnd(e) {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === leftTouchId) {
                leftTouchId = null;
                touchJoystick.active = false;
                touchJoystick.x = 0;
                touchJoystick.y = 0;
                mobileMoveTarget.x = 0;
                mobileMoveTarget.y = 0;
                resetJoystickKnob();
            }

            if (touch.identifier === rightTouchId) {
                rightTouchId = null;
                touchAim.active = false;
                mouse.down = false;
            }
        }
    }
    
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    
    // Button handlers
    dashButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        keys['shift'] = true;
    });
    dashButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        keys['shift'] = false;
    });
    
    pauseButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        paused = !paused;
        gameState = paused ? 'paused' : 'playing';
    });
    
    muteButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        muted = !muted;
        muteButton.textContent = muted ? '🔇' : '🔊';
    });
    
    // Click handlers for desktop compatibility
    dashButton.addEventListener('click', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        keys['shift'] = true;
        setTimeout(() => { keys['shift'] = false; }, 100);
    });
    
    pauseButton.addEventListener('click', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        paused = !paused;
        gameState = paused ? 'paused' : 'playing';
    });
    
    muteButton.addEventListener('click', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        muted = !muted;
        muteButton.textContent = muted ? '🔇' : '🔊';
    });
    
    // Prevent default touch behaviors
    document.addEventListener('touchstart', (e) => {
        if (e.target === canvas || e.target.closest('.mobile-controls')) {
            e.preventDefault();
        }
    }, { passive: false });
    
    document.addEventListener('touchmove', (e) => {
        if (e.target === canvas || e.target.closest('.mobile-controls')) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // Initialize audio on first user interaction
    document.addEventListener('pointerdown', initAudio, { once: true });
    document.addEventListener('touchstart', initAudio, { once: true });
    document.addEventListener('click', initAudio, { once: true });

    // Audio context and sounds (mobile-friendly lazy init)
    let audioContext = null;
    let audioInitialized = false;
    
    function initAudio() {
        if (audioInitialized || muted) return;
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioInitialized = true;
            const hint = document.getElementById('audioHint');
            if (hint) hint.classList.remove('show');
        } catch (e) {
            console.warn('WebAudio not supported');
        }
    }
    
    function resumeAudio() {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }
    
    function playSound(frequency, duration, type = 'sine', volume = 0.3, pitchVariation = 0) {
        if (muted || !audioContext) return;
        
        // Sound spam limiter
        const now = Date.now();
        soundTimestamps = soundTimestamps.filter(t => now - t < 1000);
        if (soundTimestamps.length >= maxSoundsPerSecond) return;
        soundTimestamps.push(now);
        
        try {
            resumeAudio();
            
            // Improved sound design
            if (type === 'shoot') {
                // Shoot: square + noise click
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();
                const gain1 = audioContext.createGain();
                const gain2 = audioContext.createGain();
                
                osc1.type = 'square';
                osc1.frequency.value = frequency + (Math.random() - 0.5) * pitchVariation;
                gain1.gain.setValueAtTime(volume * 0.7, audioContext.currentTime);
                gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                
                osc2.type = 'square';
                osc2.frequency.value = frequency * 2 + (Math.random() - 0.5) * pitchVariation;
                gain2.gain.setValueAtTime(volume * 0.3, audioContext.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration * 0.5);
                
                osc1.connect(gain1);
                osc2.connect(gain2);
                gain1.connect(audioContext.destination);
                gain2.connect(audioContext.destination);
                osc1.start();
                osc2.start();
                osc1.stop(audioContext.currentTime + duration);
                osc2.stop(audioContext.currentTime + duration * 0.5);
            } else if (type === 'kill') {
                // Kill: low pop + pitch drop
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();
                const gain1 = audioContext.createGain();
                const gain2 = audioContext.createGain();
                
                osc1.type = 'sawtooth';
                osc1.frequency.setValueAtTime(frequency, audioContext.currentTime);
                osc1.frequency.exponentialRampToValueAtTime(frequency * 0.5, audioContext.currentTime + duration);
                gain1.gain.setValueAtTime(volume, audioContext.currentTime);
                gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                
                osc2.type = 'sawtooth';
                osc2.frequency.value = frequency * 0.7;
                gain2.gain.setValueAtTime(volume * 0.5, audioContext.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration * 0.6);
                
                osc1.connect(gain1);
                osc2.connect(gain2);
                gain1.connect(audioContext.destination);
                gain2.connect(audioContext.destination);
                osc1.start();
                osc2.start();
                osc1.stop(audioContext.currentTime + duration);
                osc2.stop(audioContext.currentTime + duration * 0.6);
            } else if (type === 'dash') {
                // Dash: whoosh (sawtooth ramp)
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(frequency * 0.5, audioContext.currentTime);
                osc.frequency.exponentialRampToValueAtTime(frequency * 1.5, audioContext.currentTime + duration);
                gain.gain.setValueAtTime(volume, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start();
                osc.stop(audioContext.currentTime + duration);
            } else if (type === 'wave') {
                // Wave: chord (two sines)
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();
                const gain1 = audioContext.createGain();
                const gain2 = audioContext.createGain();
                osc1.type = 'sine';
                osc1.frequency.value = frequency;
                osc2.type = 'sine';
                osc2.frequency.value = frequency * 1.5;
                gain1.gain.setValueAtTime(volume, audioContext.currentTime);
                gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                gain2.gain.setValueAtTime(volume * 0.7, audioContext.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc1.connect(gain1);
                osc2.connect(gain2);
                gain1.connect(audioContext.destination);
                gain2.connect(audioContext.destination);
                osc1.start();
                osc2.start();
                osc1.stop(audioContext.currentTime + duration);
                osc2.stop(audioContext.currentTime + duration);
            } else {
                // Default sound
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                const pitch = pitchVariation > 0 ? frequency + (Math.random() - 0.5) * pitchVariation : frequency;
                oscillator.frequency.value = pitch;
                oscillator.type = type;
                gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + duration);
            }
        } catch (e) {
            // Ignore audio errors
        }
    }

    // Game objects
    class Player {
        constructor() {
            this.x = canvas.width / (2 * dpr);
            this.y = canvas.height / (2 * dpr);
            this.radius = 15;
            this.speed = 300;
            this.angle = 0;
            this.hp = 100;
            this.maxHp = 100;
            this.invulnerable = 0;
            this.invulnerableTime = 0.7;
            // Dash system
            this.dashActive = false;
            this.dashTimer = 0;
            this.dashDuration = 0.2;
            this.dashCooldown = 0;
            this.dashCooldownTime = 2;
            this.dashSpeed = 3;
            this.dashDirection = { x: 0, y: 0 };
            this.ghostAfterimages = [];
            this.recoilOffset = 0;
        }

        update(dt) {
            // Update dash cooldown
            if (this.dashCooldown > 0) {
                this.dashCooldown -= dt;
            }
            
            // Dash activation
            if ((keys['shift'] || keys['shiftleft'] || keys['shiftright']) && !this.dashActive && this.dashCooldown <= 0) {
                let dx = 0, dy = 0;
                if (keys['w'] || keys['arrowup']) dy -= 1;
                if (keys['s'] || keys['arrowdown']) dy += 1;
                if (keys['a'] || keys['arrowleft']) dx -= 1;
                if (keys['d'] || keys['arrowright']) dx += 1;
                
                if (dx !== 0 || dy !== 0) {
                    const len = Math.sqrt(dx * dx + dy * dy);
                    this.dashDirection.x = dx / len;
                    this.dashDirection.y = dy / len;
                } else {
                    this.dashDirection.x = Math.cos(this.angle);
                    this.dashDirection.y = Math.sin(this.angle);
                }
                
                this.dashActive = true;
                this.dashTimer = this.dashDuration;
                this.dashCooldown = this.dashCooldownTime;
                this.invulnerable = this.dashDuration;
                const particleCount = isMobile ? 8 : 12;
                spawnParticles(this.x, this.y, particleCount);
                addShake(3);
                playSound(400, 0.2, 'dash', 0.25);
            }
            
            // Dash movement
            if (this.dashActive) {
                this.dashTimer -= dt;
                
                this.ghostAfterimages.push({
                    x: this.x,
                    y: this.y,
                    angle: this.angle,
                    alpha: 0.6,
                    age: 0
                });
                if (this.ghostAfterimages.length > 5) {
                    this.ghostAfterimages.shift();
                }
                
                if (this.dashTimer <= 0) {
                    this.dashActive = false;
                } else {
                    this.x += this.dashDirection.x * this.speed * this.dashSpeed * dt;
                    this.y += this.dashDirection.y * this.speed * this.dashSpeed * dt;
                }
            } else {
                this.ghostAfterimages = this.ghostAfterimages.filter(ghost => {
                    ghost.age += dt;
                    ghost.alpha -= dt * 2;
                    return ghost.alpha > 0;
                });
            }
            
            // Update recoil
            if (this.recoilOffset > 0) {
                this.recoilOffset -= dt * 20;
                if (this.recoilOffset < 0) this.recoilOffset = 0;
            }
            
            if (!this.dashActive) {
                // Normal movement - mobile joystick or keyboard
                let dx = 0, dy = 0;
                let keyDx = 0, keyDy = 0;

                if (isMobile) {
                    mobileMoveInput.x = lerp(mobileMoveInput.x, mobileMoveTarget.x, joystickLerp);
                    mobileMoveInput.y = lerp(mobileMoveInput.y, mobileMoveTarget.y, joystickLerp);
                    if (Math.abs(mobileMoveInput.x) < 0.001) mobileMoveInput.x = 0;
                    if (Math.abs(mobileMoveInput.y) < 0.001) mobileMoveInput.y = 0;
                }

                if (keys['w'] || keys['arrowup']) keyDy -= 1;
                if (keys['s'] || keys['arrowdown']) keyDy += 1;
                if (keys['a'] || keys['arrowleft']) keyDx -= 1;
                if (keys['d'] || keys['arrowright']) keyDx += 1;
                
                if (keyDx !== 0 || keyDy !== 0) {
                    const len = Math.sqrt(keyDx * keyDx + keyDy * keyDy);
                    dx = keyDx / len;
                    dy = keyDy / len;
                } else if (isMobile && (touchJoystick.active || mobileMoveInput.x !== 0 || mobileMoveInput.y !== 0)) {
                    dx = mobileMoveInput.x;
                    dy = mobileMoveInput.y;
                }
                
                if (dx !== 0 || dy !== 0) {
                    this.x += dx * this.speed * dt;
                    this.y += dy * this.speed * dt;
                }
            }
            
            // Keep in bounds
            const margin = this.radius;
            this.x = Math.max(margin, Math.min(canvas.width / dpr - margin, this.x));
            this.y = Math.max(margin, Math.min(canvas.height / dpr - margin, this.y));
            
            // Aim at mouse or touch
            let aimX = mouse.worldX;
            let aimY = mouse.worldY;
            if (isMobile && touchAim.active) {
                aimX = touchAim.x;
                aimY = touchAim.y;
            }
            const dx2 = aimX - this.x;
            const dy2 = aimY - this.y;
            this.angle = Math.atan2(dy2, dx2);
            
            // Update invulnerability
            if (this.invulnerable > 0 && !this.dashActive) {
                this.invulnerable -= dt;
            }
        }

        takeDamage(amount) {
            if (this.invulnerable > 0 || this.dashActive) return false;
            this.hp -= amount;
            this.invulnerable = this.invulnerableTime;
            addShake(6);
            hitstop = 0.03;
            playSound(150, 0.08, 'square', 0.4);
            if (this.hp <= 0) {
                this.hp = 0;
                playSound(80, 0.4, 'sawtooth', 0.5);
                return true;
            }
            return false;
        }

        render(ctx) {
            // Render ghost afterimages
            this.ghostAfterimages.forEach(ghost => {
                ctx.save();
                ctx.globalAlpha = ghost.alpha;
                ctx.translate(ghost.x, ghost.y);
                ctx.rotate(ghost.angle);
                ctx.fillStyle = '#4a9eff';
                ctx.beginPath();
                ctx.arc(0, 0, this.radius * 0.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
            
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            
            if (this.dashActive) {
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#4a9eff';
                // Dash invulnerability outline
                ctx.strokeStyle = '#0ff';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, this.radius + 2, 0, Math.PI * 2);
                ctx.stroke();
            }
            
            if (this.invulnerable > 0 && !this.dashActive) {
                ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.invulnerable * 20);
            }
            
            ctx.fillStyle = '#4a9eff';
            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#2a6fbf';
            ctx.fillRect(this.radius - 2 - this.recoilOffset, -3, 12, 6);
            
            ctx.restore();
            
            // HP bar
            const barWidth = 60;
            const barHeight = 6;
            const barX = this.x - barWidth / 2;
            const barY = this.y - this.radius - 15;
            ctx.fillStyle = '#333';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            ctx.fillStyle = this.hp > 30 ? '#0f0' : '#f00';
            ctx.fillRect(barX, barY, barWidth * (this.hp / this.maxHp), barHeight);
            
            // Dash cooldown indicator
            if (this.dashCooldown > 0) {
                const dashBarWidth = 40;
                const dashBarHeight = 4;
                const dashBarX = this.x - dashBarWidth / 2;
                const dashBarY = this.y + this.radius + 8;
                ctx.fillStyle = '#333';
                ctx.fillRect(dashBarX, dashBarY, dashBarWidth, dashBarHeight);
                ctx.fillStyle = '#0ff';
                ctx.fillRect(dashBarX, dashBarY, dashBarWidth * (1 - this.dashCooldown / this.dashCooldownTime), dashBarHeight);
            }
        }
    }

    class Bullet {
        constructor(x, y, angle) {
            this.x = x;
            this.y = y;
            this.prevX = x;
            this.prevY = y;
            this.angle = angle;
            this.speed = 600;
            this.radius = 4;
            this.lifetime = 2;
            this.age = 0;
        }

        update(dt) {
            this.prevX = this.x;
            this.prevY = this.y;
            this.x += Math.cos(this.angle) * this.speed * dt;
            this.y += Math.sin(this.angle) * this.speed * dt;
            this.age += dt;
        }

        isOffscreen() {
            const margin = 50;
            return this.x < -margin || this.x > canvas.width / dpr + margin ||
                   this.y < -margin || this.y > canvas.height / dpr + margin ||
                   this.age >= this.lifetime;
        }

        render(ctx) {
            const dist = Math.sqrt((this.x - this.prevX) ** 2 + (this.y - this.prevY) ** 2);
            if (dist > 0) {
                ctx.strokeStyle = '#ffaa00';
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.7;
                ctx.shadowBlur = 8;
                ctx.shadowColor = '#ffaa00';
                ctx.beginPath();
                ctx.moveTo(this.prevX, this.prevY);
                ctx.lineTo(this.x, this.y);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1;
            }
            
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#ffaa00';
            ctx.fillStyle = '#ffaa00';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    class Enemy {
        constructor() {
            const side = Math.floor(Math.random() * 4);
            const margin = 50;
            if (side === 0) {
                this.x = -margin;
                this.y = Math.random() * canvas.height / dpr;
            } else if (side === 1) {
                this.x = canvas.width / dpr + margin;
                this.y = Math.random() * canvas.height / dpr;
            } else if (side === 2) {
                this.x = Math.random() * canvas.width / dpr;
                this.y = -margin;
            } else {
                this.x = Math.random() * canvas.width / dpr;
                this.y = canvas.height / dpr + margin;
            }
            this.radius = 12 + Math.random() * 8;
            this.speed = 80 + Math.random() * 40;
            this.hp = 1;
            this.hitFlash = 0;
        }

        update(dt) {
            if (this.hitFlash > 0) {
                this.hitFlash -= dt;
            }
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0) {
                this.x += (dx / dist) * this.speed * dt;
                this.y += (dy / dist) * this.speed * dt;
            }
        }

        render(ctx) {
            if (this.hitFlash > 0) {
                ctx.fillStyle = '#ffffff';
            } else {
                ctx.fillStyle = '#ff4444';
            }
            
            ctx.shadowBlur = 5;
            ctx.shadowColor = '#ff4444';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            
            ctx.strokeStyle = '#aa0000';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    class Particle {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.vx = (Math.random() - 0.5) * 200;
            this.vy = (Math.random() - 0.5) * 200;
            this.lifetime = 0.5;
            this.age = 0;
            this.size = 2 + Math.random() * 3;
            this.color = `hsl(${Math.random() * 60}, 100%, ${50 + Math.random() * 50}%)`;
        }

        update(dt) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.vx *= 0.95;
            this.vy *= 0.95;
            this.age += dt;
        }

        isDead() {
            return this.age >= this.lifetime;
        }

        render(ctx) {
            const alpha = 1 - (this.age / this.lifetime);
            ctx.globalAlpha = alpha;
            ctx.shadowBlur = 4;
            ctx.shadowColor = this.color;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        }
    }

    class Shockwave {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.radius = 0;
            this.maxRadius = 40;
            this.lifetime = 0.3;
            this.age = 0;
        }

        update(dt) {
            this.age += dt;
            this.radius = (this.age / this.lifetime) * this.maxRadius;
        }

        isDead() {
            return this.age >= this.lifetime;
        }

        render(ctx) {
            const alpha = 1 - (this.age / this.lifetime);
            ctx.globalAlpha = alpha * 0.6;
            ctx.strokeStyle = '#ffaa00';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    // Game entities
    let player = new Player();
    let bullets = [];
    let enemies = [];
    let particles = [];
    let shockwaves = [];
    let lastShotTime = 0;
    let shootCooldown = 0.15;
    let enemySpawnTimer = 0;
    let enemySpawnRate = 2;
    let enemiesPerWave = 5;
    let waveBannerTime = 0;
    let waveBannerDuration = 2;
    
    function getMaxParticles() {
        return isMobile ? 150 : 250;
    }

    function addShake(intensity) {
        screenShake.x += (Math.random() - 0.5) * intensity * 2;
        screenShake.y += (Math.random() - 0.5) * intensity * 2;
    }

    function spawnEnemy() {
        enemies.push(new Enemy());
    }

    function spawnParticles(x, y, count) {
        // Limit particle count for performance
        const maxP = getMaxParticles();
        const actualCount = Math.min(count, maxP - particles.length);
        if (actualCount <= 0) return;
        
        for (let i = 0; i < actualCount; i++) {
            particles.push(new Particle(x, y));
        }
    }
    
    function spawnShockwave(x, y) {
        shockwaves.push(new Shockwave(x, y));
    }

    function checkCollisions() {
        // Bullets vs Enemies
        for (let i = bullets.length - 1; i >= 0; i--) {
            const bullet = bullets[i];
            for (let j = enemies.length - 1; j >= 0; j--) {
                const enemy = enemies[j];
                const dx = bullet.x - enemy.x;
                const dy = bullet.y - enemy.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                // Mobile assist: slightly larger hit radius
                const hitRadius = isMobile ? bullet.radius + enemy.radius + 2 : bullet.radius + enemy.radius;
                if (dist < hitRadius) {
                    enemy.hitFlash = 0.1;
                    const particleCount = isMobile ? 12 : 20;
                    spawnParticles(enemy.x, enemy.y, particleCount);
                    spawnShockwave(enemy.x, enemy.y);
                    enemies.splice(j, 1);
                    bullets.splice(i, 1);
                    
                    combo++;
                    comboTimer = comboResetTime;
                    const scoreGain = 10 * combo;
                    score += scoreGain;
                    
                    hitstop = 0.05;
                    addShake(12);
                    playSound(200, 0.15, 'kill', 0.3);
                    break;
                }
            }
        }

        // Enemies vs Player
        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            const dx = enemy.x - player.x;
            const dy = enemy.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < enemy.radius + player.radius) {
                const died = player.takeDamage(10);
                if (died) {
                    const particleCount = isMobile ? 20 : 30;
                    spawnParticles(player.x, player.y, particleCount);
                    gameState = 'gameOver';
                }
                const particleCount = isMobile ? 12 : 18;
                spawnParticles(enemy.x, enemy.y, particleCount);
                enemies.splice(i, 1);
                
                combo = 0;
                comboTimer = 0;
                
                score += 10;
                addShake(8);
                hitstop = 0.03;
                playSound(150, 0.08, 'square', 0.4);
            }
        }
    }

    function restart() {
        player = new Player();
        bullets = [];
        enemies = [];
        particles = [];
        shockwaves = [];
        score = 0;
        wave = 1;
        enemySpawnTimer = 0;
        enemiesPerWave = 5;
        waveBannerTime = 0;
        gameState = 'playing';
        paused = false;
        screenShake = { x: 0, y: 0 };
        hitstop = 0;
        combo = 0;
        comboTimer = 0;
        lastShotTime = 0;
        touchJoystick.active = false;
        touchAim.active = false;
        mobileMoveInput.x = 0;
        mobileMoveInput.y = 0;
        mobileMoveTarget.x = 0;
        mobileMoveTarget.y = 0;
        leftTouchId = null;
        rightTouchId = null;
    }

    // Game loop
    let lastTime = performance.now();
    let fps = 60;
    let fpsTimer = 0;

    function gameLoop(currentTime) {
        const dt = Math.min((currentTime - lastTime) / 1000, 0.033);
        lastTime = currentTime;

        fpsTimer += dt;
        if (fpsTimer >= 0.5) {
            fps = Math.round(1 / dt);
            fpsTimer = 0;
        }

        // Render function
        function render() {
            ctx.save();
            ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            
            ctx.translate(screenShake.x, screenShake.y);

            // Muzzle flash
            if (gameState === 'playing' && !paused) {
                const now = currentTime / 1000;
                const isShooting = mouse.down || keys[' '] || (isMobile && touchAim.active);
                if (isShooting && now - lastShotTime < 0.05) {
                    const flashX = player.x + Math.cos(player.angle) * (player.radius + 8);
                    const flashY = player.y + Math.sin(player.angle) * (player.radius + 8);
                    ctx.save();
                    ctx.translate(flashX, flashY);
                    ctx.rotate(player.angle);
                    ctx.fillStyle = '#ff8800';
                    ctx.globalAlpha = 0.9;
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = '#ff8800';
                    ctx.beginPath();
                    ctx.moveTo(0, -4);
                    ctx.lineTo(10, 0);
                    ctx.lineTo(0, 4);
                    ctx.closePath();
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.globalAlpha = 1;
                    ctx.restore();
                }
            }
            
            bullets.forEach(bullet => bullet.render(ctx));
            enemies.forEach(enemy => enemy.render(ctx));
            shockwaves.forEach(sw => sw.render(ctx));
            particles.forEach(p => p.render(ctx));
            player.render(ctx);

            ctx.restore();
        }

        if (gameState === 'playing' && !paused) {
            // Hitstop handling
            if (hitstop > 0) {
                hitstop -= dt;
                screenShake.x *= shakeDecay;
                screenShake.y *= shakeDecay;
                
                enemies.forEach(enemy => {
                    if (enemy.hitFlash > 0) {
                        enemy.hitFlash -= dt;
                    }
                });
                
                if (player.recoilOffset > 0) {
                    player.recoilOffset -= dt * 20;
                    if (player.recoilOffset < 0) player.recoilOffset = 0;
                }
                
                player.ghostAfterimages = player.ghostAfterimages.filter(ghost => {
                    ghost.age += dt;
                    ghost.alpha -= dt * 2;
                    return ghost.alpha > 0;
                });
                
                // Update shockwaves during hitstop
                shockwaves = shockwaves.filter(sw => {
                    sw.update(dt);
                    return !sw.isDead();
                });
                
                render();
                requestAnimationFrame(gameLoop);
                return;
            }
            
            // Normal updates
            screenShake.x *= shakeDecay;
            screenShake.y *= shakeDecay;
            
            if (comboTimer > 0) {
                comboTimer -= dt;
                if (comboTimer <= 0) {
                    combo = 0;
                }
            }

            player.update(dt);

            // Shooting
            const now = currentTime / 1000;
            const isShooting = mouse.down || keys[' '] || (isMobile && touchAim.active);
            if (isShooting && now - lastShotTime >= shootCooldown) {
                const bulletX = player.x + Math.cos(player.angle) * (player.radius + 5);
                const bulletY = player.y + Math.sin(player.angle) * (player.radius + 5);
                bullets.push(new Bullet(bulletX, bulletY, player.angle));
                lastShotTime = now;
                player.recoilOffset = 3;
                playSound(800, 0.05, 'shoot', 0.2);
            }

            bullets = bullets.filter(bullet => {
                bullet.update(dt);
                return !bullet.isOffscreen();
            });

            enemySpawnTimer -= dt;
            if (waveBannerTime <= 0 && enemySpawnTimer <= 0 && enemies.length < enemiesPerWave) {
                spawnEnemy();
                enemySpawnTimer = enemySpawnRate;
            }

            enemies.forEach(enemy => enemy.update(dt));

            particles = particles.filter(p => {
                p.update(dt);
                return !p.isDead();
            });
            
            // Update shockwaves
            shockwaves = shockwaves.filter(sw => {
                sw.update(dt);
                return !sw.isDead();
            });

            if (waveBannerTime > 0) {
                waveBannerTime -= dt;
            } else if (enemies.length === 0 && enemySpawnTimer <= 0) {
                wave++;
                enemiesPerWave = 5 + wave * 2;
                enemySpawnRate = Math.max(0.5, 2 - wave * 0.1);
                waveBannerTime = waveBannerDuration;
                playSound(500, 0.3, 'wave', 0.5);
            }

            checkCollisions();
        }
        
        render();

        // UI
        ctx.fillStyle = '#fff';
        ctx.font = '20px monospace';
        ctx.fillText(`Score: ${score}`, 10, 30);
        ctx.fillText(`Wave: ${wave}`, 10, 60);
        ctx.fillText(`HP: ${Math.max(0, Math.floor(player.hp))}`, 10, 90);
        
        if (combo > 1) {
            const comboScale = 1 + Math.sin(comboTimer * 5) * 0.15;
            const comboAlpha = Math.min(1, comboTimer / comboResetTime * 2);
            ctx.save();
            ctx.translate(10, 120);
            ctx.scale(comboScale, comboScale);
            ctx.globalAlpha = comboAlpha;
            ctx.fillStyle = '#ffaa00';
            ctx.font = 'bold 24px monospace';
            ctx.shadowBlur = 5;
            ctx.shadowColor = '#ffaa00';
            ctx.fillText(`${combo}x COMBO!`, 0, 0);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            ctx.restore();
        }
        
        if (muted) {
            ctx.fillStyle = '#ff0';
            ctx.fillText('MUTED', 10, canvas.height / dpr - 10);
        }

        if (waveBannerTime > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 48px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`WAVE ${wave}`, canvas.width / (2 * dpr), canvas.height / (2 * dpr));
            ctx.textAlign = 'left';
        }

        if (paused) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 36px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('PAUSED', canvas.width / (2 * dpr), canvas.height / (2 * dpr));
            ctx.textAlign = 'left';
        }

        if (gameState === 'gameOver') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 36px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('GAME OVER', canvas.width / (2 * dpr), canvas.height / (2 * dpr) - 40);
            ctx.font = '24px monospace';
            ctx.fillText(`Final Score: ${score}`, canvas.width / (2 * dpr), canvas.height / (2 * dpr));
            ctx.fillText(`Wave: ${wave}`, canvas.width / (2 * dpr), canvas.height / (2 * dpr) + 40);
            ctx.fillText('Press R to restart', canvas.width / (2 * dpr), canvas.height / (2 * dpr) + 80);
            ctx.textAlign = 'left';
        }

        if (debug) {
            ctx.fillStyle = '#0f0';
            ctx.font = '14px monospace';
            ctx.fillText(`FPS: ${fps}`, canvas.width / dpr - 100, 20);
            ctx.fillText(`Bullets: ${bullets.length}`, canvas.width / dpr - 100, 40);
            ctx.fillText(`Enemies: ${enemies.length}`, canvas.width / dpr - 100, 60);
            ctx.fillText(`Particles: ${particles.length}`, canvas.width / dpr - 100, 80);
            
            ctx.strokeStyle = '#0f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
            ctx.stroke();
            enemies.forEach(enemy => {
                ctx.beginPath();
                ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
                ctx.stroke();
            });
        }

        requestAnimationFrame(gameLoop);
    }

    requestAnimationFrame(gameLoop);
})();
