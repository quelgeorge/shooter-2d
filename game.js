// How to run: Open index.html directly in a web browser. No server required.
// Controls: WASD/Arrows = move, Mouse = aim, LMB/Space = shoot, P/Esc = pause, R = restart, M = mute, ~ = debug

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
    window.addEventListener('resize', resizeCanvas);

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

    // Audio context and sounds
    let audioContext = null;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn('WebAudio not supported');
    }

    function playSound(frequency, duration, type = 'sine', volume = 0.3, pitchVariation = 0) {
        if (muted || !audioContext) return;
        try {
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
                spawnParticles(this.x, this.y, 8);
                addShake(3);
                playSound(400, 0.2, 'sawtooth', 0.25, 100);
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
                // Normal movement
                let dx = 0, dy = 0;
                if (keys['w'] || keys['arrowup']) dy -= 1;
                if (keys['s'] || keys['arrowdown']) dy += 1;
                if (keys['a'] || keys['arrowleft']) dx -= 1;
                if (keys['d'] || keys['arrowright']) dx += 1;
                
                if (dx !== 0 || dy !== 0) {
                    const len = Math.sqrt(dx * dx + dy * dy);
                    dx /= len;
                    dy /= len;
                    this.x += dx * this.speed * dt;
                    this.y += dy * this.speed * dt;
                }
            }
            
            // Keep in bounds
            const margin = this.radius;
            this.x = Math.max(margin, Math.min(canvas.width / dpr - margin, this.x));
            this.y = Math.max(margin, Math.min(canvas.height / dpr - margin, this.y));
            
            // Aim at mouse
            const dx2 = mouse.worldX - this.x;
            const dy2 = mouse.worldY - this.y;
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

    // Game entities
    let player = new Player();
    let bullets = [];
    let enemies = [];
    let particles = [];
    let lastShotTime = 0;
    let shootCooldown = 0.15;
    let enemySpawnTimer = 0;
    let enemySpawnRate = 2;
    let enemiesPerWave = 5;
    let waveBannerTime = 0;
    let waveBannerDuration = 2;

    function addShake(intensity) {
        screenShake.x += (Math.random() - 0.5) * intensity * 2;
        screenShake.y += (Math.random() - 0.5) * intensity * 2;
    }

    function spawnEnemy() {
        enemies.push(new Enemy());
    }

    function spawnParticles(x, y, count) {
        for (let i = 0; i < count; i++) {
            particles.push(new Particle(x, y));
        }
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
                if (dist < bullet.radius + enemy.radius) {
                    enemy.hitFlash = 0.1;
                    spawnParticles(enemy.x, enemy.y, 15);
                    enemies.splice(j, 1);
                    bullets.splice(i, 1);
                    
                    combo++;
                    comboTimer = comboResetTime;
                    const scoreGain = 10 * combo;
                    score += scoreGain;
                    
                    hitstop = 0.05;
                    addShake(12);
                    playSound(200, 0.15, 'sawtooth', 0.3, 30);
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
                    spawnParticles(player.x, player.y, 30);
                    gameState = 'gameOver';
                }
                spawnParticles(enemy.x, enemy.y, 15);
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
                if ((mouse.down || keys[' ']) && now - lastShotTime < 0.05) {
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
            if ((mouse.down || keys[' ']) && now - lastShotTime >= shootCooldown) {
                const bulletX = player.x + Math.cos(player.angle) * (player.radius + 5);
                const bulletY = player.y + Math.sin(player.angle) * (player.radius + 5);
                bullets.push(new Bullet(bulletX, bulletY, player.angle));
                lastShotTime = now;
                player.recoilOffset = 3;
                playSound(800, 0.05, 'square', 0.2, 50);
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

            if (waveBannerTime > 0) {
                waveBannerTime -= dt;
            } else if (enemies.length === 0 && enemySpawnTimer <= 0) {
                wave++;
                enemiesPerWave = 5 + wave * 2;
                enemySpawnRate = Math.max(0.5, 2 - wave * 0.1);
                waveBannerTime = waveBannerDuration;
                playSound(500, 0.3, 'sine', 0.5);
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
