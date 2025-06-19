const { createApp, ref, onMounted } = Vue;

createApp({
    setup() {
        const printers = ref([]);
        const newPrinterIP = ref('');
        const showSetupScreen = ref(true);
        const currentTheme = ref('light');
        const themeIcon = ref('fas fa-moon');

        const loadTheme = () => {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme) {
                currentTheme.value = savedTheme;
                document.documentElement.setAttribute('data-theme', savedTheme);
                themeIcon.value = savedTheme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        };

        const toggleTheme = () => {
            currentTheme.value = currentTheme.value === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', currentTheme.value);
            localStorage.setItem('theme', currentTheme.value);
            themeIcon.value = currentTheme.value === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        };

        const statusIcon = (status) => {
            switch (status) {
                case 'operational': return 'fas fa-check-circle';
                case 'error': return 'fas fa-exclamation-circle';
                case 'offline': return 'fas fa-plug-circle-xmark';
                case 'printing': return 'fas fa-print';
                case 'paused': return 'fas fa-pause-circle';
                case 'complete': return 'fas fa-check-circle';
                case 'standby': return 'fas fa-coffee';
                default: return 'fas fa-info-circle';
            }
        };

        const initializePrinterData = (printer) => {
            return {
                name: printer.name || `Принтер ${Date.now()}`,
                ip: printer.ip || 'http://localhost',
                status: printer.status || 'Недоступен',
                statusText: printer.statusText || 'Загрузка...',
                extruder_temp: printer.extruder_temp || '-',
                extruder1_temp: printer.extruder1_temp || '-',
                bed_temp: printer.bed_temp || '-',
                chamber_temp: printer.chamber_temp || '-',
                filename: printer.filename || 'Нет данных',
                filename_without_ext: printer.filename_without_ext || '',
                webcam_available: printer.webcam_available ?? true,
                remaining_time: printer.remaining_time || null  // Новое поле
            };
        };

        const loadConfig = async () => {
            try {
                const response = await fetch('/get_config');
                const config = await response.json();
                printers.value = (config.printers || []).map(initializePrinterData);
                showSetupScreen.value = printers.value.length === 0;

                if (printers.value.length > 0) {
                    updateAllStatuses();
                }
            } catch (e) {
                console.error("Ошибка загрузки конфигурации:", e);
                showSetupScreen.value = true;
            }
        };

        const addPrinter = async () => {
            if (!newPrinterIP.value.trim()) return;

            try {
                const response = await fetch('/add_printer', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ip: newPrinterIP.value})
                });

                const result = await response.json();

                if (response.ok) {
                    await loadConfig();
                    newPrinterIP.value = '';
                } else {
                    console.error("Ошибка добавления принтера:", result.error);
                    alert(`Ошибка: ${result.error || 'Неизвестная ошибка'}`);
                }
            } catch (e) {
                console.error("Сетевая ошибка:", e);
                alert("Сетевая ошибка при добавлении принтера");
            }
        };

        const deletePrinter = async (ip) => {
            if (!confirm("Удалить принтер из списка?")) return;

            try {
                const index = printers.value.findIndex(p => p.ip === ip);
                if (index === -1) return;

                const response = await fetch(`/delete_printer/${index}`, { method: 'DELETE' });
                const result = await response.json();

                if (response.ok) {
                    await loadConfig();
                } else {
                    console.error("Ошибка удаления принтера:", result.error);
                    alert(`Ошибка: ${result.error || 'Неизвестная ошибка'}`);
                }
            } catch (e) {
                console.error("Сетевая ошибка:", e);
                alert("Сетевая ошибка при удалении принтера");
            }
        };

        const getWebcamImage = (printer) => {
            if (printer.status === "offline") {
                return '/static/default_printer.jpg';
            }

            if (printer.webcam_available) {
                return `${printer.ip}/webcam/?action=stream`;
            }

            if ((printer.status === 'printing' || printer.status === 'paused') && printer.filename_without_ext) {
                return `${printer.ip}/server/files/gcodes/.thumbs/${printer.filename_without_ext}-300x300.png`;
            }

            return '/static/default_printer.jpg';
        };

        const handleImageError = (event, printer, index) => {
            if (printer.webcam_available) {
                printers.value[index].webcam_available = false;

                if ((printer.status === 'printing' || printer.status === 'paused') && printer.filename_without_ext) {
                    event.target.src = `${printer.ip}/server/files/gcodes/.thumbs/${printer.filename_without_ext}-300x300.png`;
                    return;
                }
            }

            event.target.src = '/static/default_printer.jpg';
        };

        const updatePrinterStatus = async (index) => {
            try {
                const response = await fetch(`/printer_status/${index}`);
                const data = await response.json();

                if (data.error || data.status === "offline") {
                    printers.value[index] = {
                        ...printers.value[index],
                        status: "offline",
                        statusText: "Принтер недоступен",
                        extruder_temp: "-",
                        extruder1_temp: "-",
                        bed_temp: "-",
                        chamber_temp: "-",
                        filename: "Нет данных",
                        filename_without_ext: "",
                        webcam_available: false,
                        remaining_time: null  // Сбрасываем время
                    };
                    return;
                }

                printers.value[index] = {
                    ...printers.value[index],
                    ...data,
                    extruder_temp: data.extruder_temp ? Math.round(data.extruder_temp) : '-',
                    extruder1_temp: data.extruder1_temp ? Math.round(data.extruder1_temp) : '-',
                    bed_temp: data.bed_temp ? Math.round(data.bed_temp) : '-',
                    chamber_temp: data.chamber_temp ? Math.round(data.chamber_temp) : '-',
                    filename: data.filename || 'Нет данных',
                    filename_without_ext: data.filename_without_ext || '',
                    remaining_time: data.remaining_time  // Сохраняем время
                };
            } catch (e) {
                printers.value[index].status = 'error';
                printers.value[index].statusText = 'Ошибка соединения';
                printers.value[index].remaining_time = null;  // Сбрасываем время при ошибке
            }
        };

        const updateAllStatuses = () => {
            printers.value.forEach((_, index) => {
                updatePrinterStatus(index);
                setInterval(() => updatePrinterStatus(index), 5000);
            });
        };

        const openPrinterWebUI = (printer) => {
            window.open(printer.ip, '_blank');
        };

        const updatePrinter = (index) => {
            const printer = printers.value[index];
            fetch(`/update_printer/${index}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: printer.name})
            });
        };

        const emergencyStop = async (ip) => {
            const index = printers.value.findIndex(p => p.ip === ip);
            if (index === -1) return;

            if (!confirm("Вы уверены, что хотите выполнить аварийную остановку принтера?")) {
                return;
            }

            try {
                const response = await fetch(`/emergency_stop/${index}`, {
                    method: 'POST'
                });

                const result = await response.json();

                if (response.ok) {
                    alert("Команда аварийной остановки отправлена");
                    updatePrinterStatus(index);
                } else {
                    console.error("Ошибка при аварийной остановке:", result.error);
                    alert(`Ошибка: ${result.error || 'Неизвестная ошибка'}`);
                }
            } catch (e) {
                console.error("Сетевая ошибка:", e);
                alert("Сетевая ошибка при отправке команды");
            }
        };

        const pauseResumePrint = async (ip) => {
            const index = printers.value.findIndex(p => p.ip === ip);
            if (index === -1) return;

            if (!confirm("Вы уверены, что хотите изменить состояние печати?")) {
                return;
            }

            try {
                const response = await fetch(`/pause_resume_print/${index}`, {
                    method: 'POST'
                });

                const result = await response.json();

                if (response.ok) {
                    alert("Команда отправлена");
                    updatePrinterStatus(index);
                } else {
                    console.error("Ошибка при изменении состояния печати:", result.error);
                    alert(`Ошибка: ${result.error || 'Неизвестная ошибка'}`);
                }
            } catch (e) {
                console.error("Сетевая ошибка:", e);
                alert("Сетевая ошибка при отправке команды");
            }
        };

        const cancelPrint = async (ip) => {
            const index = printers.value.findIndex(p => p.ip === ip);
            if (index === -1) return;

            if (!confirm("Вы уверены, что хотите отменить печать?")) {
                return;
            }

            try {
                const response = await fetch(`/cancel_print/${index}`, {
                    method: 'POST'
                });

                const result = await response.json();

                if (response.ok) {
                    alert("Печать отменена");
                    updatePrinterStatus(index);
                } else {
                    console.error("Ошибка при отмене печати:", result.error);
                    alert(`Ошибка: ${result.error || 'Неизвестная ошибка'}`);
                }
            } catch (e) {
                console.error("Сетевая ошибка:", e);
                alert("Сетевая ошибка при отправке команды");
            }
        };

        const toggleLight = async (ip) => {
            const index = printers.value.findIndex(p => p.ip === ip);
            if (index === -1) return;

            try {
                const response = await fetch(`/toggle_light/${index}`, {
                    method: 'POST'
                });

                const result = await response.json();

                if (response.ok) {
                    alert("Подсветка переключена");
                } else {
                    console.error("Ошибка при переключении подсветки:", result.error);
                    alert(`Ошибка: ${result.error || 'Неизвестная ошибка'}`);
                }
            } catch (e) {
                console.error("Сетевая ошибка:", e);
                alert("Сетевая ошибка при отправке команды");
            }
        };

        onMounted(() => {
            loadTheme();
            loadConfig();
        });

        return {
            printers,
            newPrinterIP,
            showSetupScreen,
            themeIcon,
            addPrinter,
            deletePrinter,
            getWebcamImage,
            handleImageError,
            updatePrinter,
            openPrinterWebUI,
            toggleTheme,
            statusIcon,
            emergencyStop,
            pauseResumePrint,
            cancelPrint,
            toggleLight
        };
    }
}).mount('#app');