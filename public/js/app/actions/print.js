define([
    'jquery',
    'helpers/file-system',
    'helpers/display',
    'helpers/websocket',
    'helpers/api/3d-print-slicing',
    'helpers/api/control',
    'helpers/file-system',
    'app/actions/alert-actions',
    'app/actions/progress-actions',
    'app/constants/device-constants',
    'app/constants/progress-constants',
    'helpers/i18n',
    // non-return value
    'threeOrbitControls',
    'threeTrackballControls',
    'threeTransformControls',
    'threeSTLLoader',
    'threeCircularGridHelper',
    'plugins/file-saver/file-saver.min',
    'lib/Canvas-To-Blob',
    'helpers/object-assign'
], function(
    $,
    fileSystem,
    display,
    websocket,
    printSlicing,
    printerController,
    FileSystem,
    AlertActions,
    ProgressActions,
    DeviceConstants,
    ProgressConstants,
    I18n
) {
    'use strict';

    var THREE = window.THREE || {},
        container, slicer;

    var camera, scene, outlineScene, renderer;
    var orbitControl, transformControl, reactSrc, controls;

    var objects = [],
        referenceMeshes = [];
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2(),
        circularGridHelper, mouseDown, SELECTED;

    var movingOffsetX, movingOffsetY, panningOffset, originalCameraPosition, originalCameraRotation,
        scaleBeforeTransformX, scaleBeforeTransformY, scaleBeforeTransformZ;

    var _id = 'PRINT.JS',
        responseBlob, printPath,
        previewScene,
        previewColors = [],
        previewUrl = '',
        blobExpired = true,
        transformMode = false,
        shiftPressed = false,
        previewMode = false,
        leftPanelWidth = 275,
        ddHelper = 0,
        defaultFileName = '',
        cameraLight,
        lang = I18n.get();

    var s = {
        diameter: 170,
        radius: 85,
        height: 180,
        step: 10,
        upVector: new THREE.Vector3(0, 0, 1),
        color: 0x777777,
        opacity: 0.2,
        text: true,
        textColor: '#000000',
        textPosition: 'center',
        colorOutside: 0xFF0000,
        colorSelected: 0xFFFF00,
        colorUnselected: 0x333333,
        degreeStep: 5,
        scalePrecision: 1, // decimal places,
        allowedMin: 1 // (mm)
    };

    var commonMaterial = new THREE.MeshPhongMaterial({
        color: s.colorUnselected,
        specular: 0x888888,
        shininess: 1
    });

    // var advancedParameters = ['layerHeight', 'infill', 'travelingSpeed', 'extrudingSpeed', 'temperature', 'advancedSettings'];

    previewColors[0] = new THREE.Color(0x996633); // infill
    previewColors[1] = new THREE.Color(0xddcc99); // perimeter
    previewColors[2] = new THREE.Color(0xbbbbbb); // support
    previewColors[3] = new THREE.Color(0xffffff); // move
    previewColors[4] = new THREE.Color(0xee9966); // skirt

    function init(src) {

        reactSrc = src;
        container = document.getElementById('model-displayer');

        camera = new THREE.PerspectiveCamera(60, (container.offsetWidth) / container.offsetHeight, 1, 30000);
        camera.position.set(0, -200, 100);
        camera.up = new THREE.Vector3(0, 0, 1);

        scene = new THREE.Scene();
        outlineScene = new THREE.Scene();

        // circular grid helper
        circularGridHelper = new CircularGridHelper(
            s.diameter,
            s.step,
            s.upVector,
            s.color,
            s.opacity,
            s.text,
            s.textColor,
            s.textPosition
        );
        circularGridHelper.name = 'circularGridHelper';
        scene.add(circularGridHelper);
        previewScene = scene.clone();

        var geometry = new THREE.CircleGeometry(s.radius, 80),
            material = new THREE.MeshBasicMaterial({
                color: 0xCCCCCC,
                transparent: true
            }),
            refMesh = new THREE.Mesh(geometry, material);

        refMesh.up = new THREE.Vector3(0, 0, 1);
        refMesh.visible = false;
        scene.add(refMesh);
        referenceMeshes.push(refMesh);

        // Lights
        scene.add(new THREE.AmbientLight(0x777777));

        _addShadowedLight(1, 1, 1, 0xffffff, 1.35);
        _addShadowedLight(0.5, 1, -1, 0xffffff, 1);
        _addShadowedLight(-1, -1, -1, 0xffffff, 1.35);
        _addShadowedLight(-0.5, -1, 1, 0xffffff, 1);

        cameraLight = new THREE.PointLight( 0xFFFFFF, 0.8, 300 );
        cameraLight.position.set(0,0,0);
        scene.cameraLight = cameraLight;
        scene.add(cameraLight);

        // renderer
        renderer = new THREE.WebGLRenderer();
        renderer.autoClear = false;
        renderer.setClearColor(0xE0E0E0, 1);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(container.offsetWidth, container.offsetHeight);
        renderer.sortObjects = false;
        container.appendChild(renderer.domElement);

        orbitControl = new THREE.OrbitControls(camera, renderer.domElement);
        orbitControl.maxPolarAngle = Math.PI / 4 * 3;
        orbitControl.maxDistance = 1000;
        orbitControl.noKeys = true;
        orbitControl.addEventListener('change', updateOrbitControl);

        transformControl = new THREE.TransformControls(camera, renderer.domElement);
        transformControl.addEventListener('change', render);
        transformControl.addEventListener('mouseDown', onTransform);
        transformControl.addEventListener('mouseUp', onTransform);
        transformControl.addEventListener('objectChange', onTransform);

        window.addEventListener('resize', onWindowResize, false);
        window.addEventListener('keydown', onKeyPress, false);
        window.addEventListener('keyup', onKeyPress, false);
        renderer.domElement.addEventListener('mousemove', onMouseMove, false);
        renderer.domElement.addEventListener('mousedown', onMouseDown, false);
        renderer.domElement.addEventListener('mouseup', onMouseUp, false);

        renderer.setSize(container.offsetWidth, container.offsetHeight);

        originalCameraPosition = camera.position.clone();
        originalCameraRotation = camera.rotation.clone();

        panningOffset = new THREE.Vector3();

        render();
        setImportWindowPosition();

        // init print controller
        slicer = printSlicing();

        registerDropToImport();
    }

    function _handleStop() {
        console.log('stopped');
    }

    function uploadStl(name, file) {
        // pass to slicer
        var d = $.Deferred();
        var reader = new FileReader();

        reader.onload = function() {
            slicer.upload(name, file, displayProgress).then(function(result) {
                ProgressActions.updating('finishing up', 100);
                d.resolve(result);
            });
        };
        reader.readAsArrayBuffer(file);
        return d.promise();
    }

    function appendModel(fileEntry, file, callback) {
        var loader = new THREE.STLLoader();
        var model_file_path = fileEntry.toURL();
        callback = callback || function() {};

        reactSrc.setState({
            openImportWindow: false
        });

        ProgressActions.open(ProgressConstants.STEPPING, lang.print.importingModel, lang.print.wait, false);

        loader.load(model_file_path, function(geometry) {
            var mesh = new THREE.Mesh(geometry, commonMaterial);
            mesh.up = new THREE.Vector3(0, 0, 1);

            ProgressActions.updating(lang.print.uploading, 40);
            uploadStl(mesh.uuid, file).then(function(result) {
                if (result.status !== 'ok') {
                    AlertActions.showPopupError('', result.status);
                }
                callback();
                ProgressActions.close();
            });

            geometry.center();

            // normalize - resize, align
            var box = new THREE.Box3().setFromObject(mesh),
                enlarge = parseInt(box.size().x) !== 0 && parseInt(box.size().y) !== 0 && parseInt(box.size().z) !== 0,
                scale = getScaleDifference(
                    enlarge ?
                    getLargestPropertyValue(box.size()) :
                    getSmallestPropertyValue(box.size())
                );

            // alert for auto scalling
            if (scale !== 1) {
                console.log('this model has been scaled for better printing ratio');
            }

            mesh.scale.set(scale, scale, scale);
            mesh.scale._x = scale;
            mesh.scale._y = scale;
            mesh.scale._z = scale;

            mesh.rotation.order = 'ZYX';

            /* customized properties */
            mesh.scale.enteredX = 1;
            mesh.scale.enteredY = 1;
            mesh.scale.enteredZ = 1;
            mesh.scale.locked = true;
            mesh.rotation.enteredX = 0;
            mesh.rotation.enteredY = 0;
            mesh.rotation.enteredZ = 0;
            mesh.position.isOutOfBounds = false;
            /* end customized property */

            if (mesh.geometry.type !== 'Geometry') {
                mesh.geometry = new THREE.Geometry().fromBufferGeometry(mesh.geometry);
            }
            mesh.name = 'custom';
            mesh.fileName = fileEntry.name;
            mesh.plane_boundary = planeBoundary(mesh);

            addSizeProperty(mesh);
            groundIt(mesh);
            selectObject(mesh);
            createOutline(mesh);

            scene.add(mesh);
            outlineScene.add(mesh.outlineMesh);
            objects.push(mesh);
            reactSrc.setState({
                hasObject: true
            });

            setDefaultFileName();
            render();
        });
    }

    function appendModels(files, index, callback) {
        if(files.item(index).name.split('.').pop().toLowerCase() === 'stl') {
            FileSystem.writeFile(
                files.item(index),
                {
                    onComplete: function(e, fileEntry) {
                        appendModel(fileEntry, files.item(index), function() {
                            if(files.length > index + 1) {
                                appendModels(files, index + 1, callback);
                            }
                            else {
                                callback();
                            }
                        });
                    }
                }
            );
        }
        else {
            callback();
        }
    }

    function registerDropToImport() {
        if(window.FileReader) {
            var zone = document.querySelector('.studio-container.print-studio');
            zone.addEventListener('dragenter', onDragEnter);
            zone.addEventListener('dragover', onDragEnter);
            zone.addEventListener('dragleave', onDragLeave);
            zone.addEventListener('drop', onDropFile);
        }
    }

    function onDropFile(e) {
        e.preventDefault();
        if(previewMode) { return; }
        var files = e.dataTransfer.files;
        if(files.length > 0) {
            appendModels(files, 0, function() {
                $('.import-indicator').hide();
                e.target.value = null;
            });
        }
    }

    function onDragEnter(e) {
        e.preventDefault();
        if(previewMode) { return; }
        if(e.type === 'dragenter') {
            ddHelper++;
        }
        $('.import-indicator').show();

        return false;
    }

    function onDragLeave(e) {
        e.preventDefault();
        if(previewMode) { return; }
        ddHelper--;

        if(ddHelper === 0) {
            $('.import-indicator').hide();
        }

        return false;
    }

    // Events Section ---

    function onMouseDown(e) {
        e.preventDefault();
        if(previewMode) { return; }
        setMousePosition(e);

        if (previewMode) {
            return;
        }

        reactSrc.setState({
            isTransforming: true
        });

        raycaster.setFromCamera(mouse, camera);
        var intersects = raycaster.intersectObjects(objects);
        var location = getReferenceIntersectLocation(e);

        if (intersects.length > 0) {

            var target = intersects[0].object;
            selectObject(target);

            orbitControl.enabled = false;
            mouseDown = true;
            container.style.cursor = 'move';

            movingOffsetX = location ? location.x - target.position.x : target.position.x;
            movingOffsetY = location ? location.y - target.position.y : target.position.y;

        }

        else {

            if (!transformMode) {
                selectObject(null);
                removeFromScene('TransformControl');
                transformControl.detach(SELECTED);
                transformMode = false;
                render();
            } else {
                if(SELECTED) {
                    scaleBeforeTransformX = SELECTED.scale.x;
                    scaleBeforeTransformY = SELECTED.scale.y;
                    scaleBeforeTransformZ = SELECTED.scale.z;
                }
            }
        }

        render();
    }

    function onMouseUp(e) {
        e.preventDefault();
        reactSrc.setState({
            isTransforming: false
        });
        orbitControl.enabled = true;
        mouseDown = false;
        container.style.cursor = 'auto';
        checkOutOfBounds(SELECTED);
        groundIt(SELECTED);

        if (transformMode) {
            selectObject(transformControl.object);
        }

        render();
    }

    function onMouseMove(e) {
        e.preventDefault();
        setMousePosition(e);

        var location = getReferenceIntersectLocation(e);
        if (SELECTED && mouseDown) {
            if (!transformMode) {
                if (SELECTED.position && location) {
                    SELECTED.position.x = location.x - movingOffsetX;
                    SELECTED.position.y = location.y - movingOffsetY;
                    SELECTED.outlineMesh.position.x = location.x - movingOffsetX;
                    SELECTED.outlineMesh.position.y = location.y - movingOffsetY;
                    blobExpired = true;
                    setObjectDialoguePosition();
                    render();
                    return;
                }
            }
        }
    }

    function onWindowResize() {
        camera.aspect = container.offsetWidth / container.offsetHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.offsetWidth, container.offsetHeight);
        render();
        setImportWindowPosition();
    }

    function onKeyPress(e) {
        if (e.keyCode === 16) {
            shiftPressed = e.type === 'keydown';
        }
    }

    function onTransform(e) {
        if(previewMode) { return; }
        switch (e.type) {
            case 'mouseDown':
                transformMode = true;
                reactSrc.setState({
                    isTransforming: true
                });
                break;
            case 'mouseUp':
                transformMode = false;
                reactSrc.setState({
                    isTransforming: false
                });
                SELECTED.rotation.enteredX = updateDegreeWithStep(radianToDegree(SELECTED.rotation.x));
                SELECTED.rotation.enteredY = updateDegreeWithStep(radianToDegree(SELECTED.rotation.y));
                SELECTED.rotation.enteredZ = updateDegreeWithStep(radianToDegree(SELECTED.rotation.z));
                updateObjectSize(SELECTED);
                break;
            case 'objectChange':
                updateObjectSize(e.target.object);
                break;
        }
    }

    // GET section ---

    // get ray intersect with reference mesh
    function getReferenceIntersectLocation(e) {
        var offx = 0,
            offy = 0;

        var vector = new THREE.Vector3(
            ((e.offsetX - offx) / container.offsetWidth) * 2 - 1, -((e.offsetY - offy) / container.offsetHeight) * 2 + 1,
            0.5
        ).unproject(camera);

        var ray = new THREE.Raycaster(camera.position, vector.sub(camera.position).normalize());
        var intersects = ray.intersectObjects(referenceMeshes);

        if (intersects.length > 0) {
            return intersects[0].point;
        }
    }

    // calculate the distance from reference mesh
    function getReferenceDistance(mesh) {
        if (mesh) {
            var ref = {},
                box = new THREE.Box3().setFromObject(mesh);
            ref.x = box.center().x;
            ref.y = box.center().y;
            ref.z = box.min.z;
            return ref;
        }
    }

    function getFileByteArray(filePath) {
        getFileObject(filePath, function(fileObject) {
            var reader = new FileReader();

            reader.onload = function(e) {
                var arrayBuffer = reader.result;
            };

            reader.readAsArrayBuffer(fileObject);
        });
    }

    // compare and return the largest axis value (for scaling)
    function getLargestPropertyValue(obj) {
        var v = 0;
        for (var property in obj) {
            if (obj.hasOwnProperty(property)) {
                if (obj[property] > v) {
                    v = obj[property];
                }
            }
        }
        return v;
    }

    function getSmallestPropertyValue(obj) {
        var v = 1;
        for (var property in obj) {
            if (obj.hasOwnProperty(property)) {
                if (obj[property] < v) {
                    v = obj[property];
                }
            }
        }
        console.log(v);
        return v;
    }

    // return the scale to fit the area
    function getScaleDifference(value) {
        var done = false,
            scale = 1;

        // if loaded object is smaller, enlarge it. offset by *10
        if (value < s.diameter) {
            while(!done) {
                if (value * scale < s.allowedMin) {
                    scale = scale * 10;
                }
                else {
                    done = true;
                }
            }

            return scale;
        }
        // if loaded object exceed printed area, shrink it (no offset)
        else {
            while (!done) {
                if (value / scale < s.diameter) {
                    done = true;
                } else {
                    scale = scale * 10;
                }
            }
            return 1 / scale;
        }
    }

    function getGCode() {
        var d = $.Deferred();
        var ids = [];

        objects.forEach(function(obj) {
            ids.push(obj.uuid);
        });

        ProgressActions.open(ProgressConstants.STEPPING, lang.monitor.processing, lang.monitor.savingPreview, false);

        getBlobFromScene().then(function(blob) {
            reactSrc.setState({ previewUrl: URL.createObjectURL(blob) });
            return slicer.uploadPreviewImage(blob);
        }).then(function(response) {
            if (response.status === 'ok') {
                sendGCodeParameters().then(function() {
                    slicer.goG(ids, function(result) {
                        if (result instanceof Blob) {
                            blobExpired = false;
                            responseBlob = result;
                            ProgressActions.close();
                            d.resolve(result);
                        }
                        else {
                            if (result.status !== 'error') {
                                var serverMessage = `${result.status}: ${result.message} (${parseInt(result.percentage * 100)}%)`,
                                    drawingMessage = `Finishing up... (100%)`,
                                    message = result.status !== 'complete' ? serverMessage : drawingMessage;
                                ProgressActions.updating(message, parseInt(result.percentage * 100));
                            }
                            else {
                                ProgressActions.close();
                            }
                        }
                    });
                });
            }
            // error
            else {
                _setProgressMessage('');
                d.resolve(result);
            }
        });

        return d.promise();
    }

    function getFCode() {
        var d = $.Deferred();
        var ids = [];

        if(objects.length === 0) {
            d.resolve('');
            return d.promise();
        }

        if(!blobExpired) {
            d.resolve(responseBlob, previewUrl);
            return d.promise();
        }

        objects.forEach(function(obj) {
            ids.push(obj.uuid);
        });

        ProgressActions.open(
            ProgressConstants.STEPPING,
            lang.print.rendering,
            lang.print.savingFilePreview,
            false
        );

        getBlobFromScene().then(function(blob) {
            previewUrl = URL.createObjectURL(blob);
            return slicer.uploadPreviewImage(blob);
        }).then(function(response) {
            if (response.status === 'ok') {
                sendGCodeParameters().then(function() {
                    slicer.goF(ids, function(result) {
                        if (result instanceof Blob) {
                            blobExpired = false;
                            responseBlob = result;
                            ProgressActions.close();
                            d.resolve(result, previewUrl);
                        }
                        else {
                            if (result.status !== 'error') {
                                var progress = `${lang.slicer[result.status]} - ${'\n' + parseInt(result.percentage * 100)}% - ${result.message}`,
                                    complete = lang.print.finishingUp;

                                if(result.status === 'warning') {
                                    AlertActions.showWarning(result.message);
                                }
                                else if(result.status !== 'complete') {
                                    ProgressActions.updating(progress, parseInt(result.percentage * 100));
                                }
                                else {
                                    ProgressActions.updating(complete, 100);
                                }
                            }
                            else {
                                ProgressActions.close();
                            }
                        }
                    });
                });
            }
            // error
            else {
                _setProgressMessage('');
                d.resolve(result);
            }
        });

        return d.promise();
    }

    function getModelCount() {
        return objects.length;
    }

    // SET section ---

    function setMousePosition(e) {
        var offx = 0,
            offy = 0;

        mouse.x = ((e.offsetX - offx) / container.offsetWidth) * 2 - 1;
        mouse.y = -((e.offsetY - offy) / container.offsetHeight) * 2 + 1;
    }

    function setScale(x, y, z, isLocked, center) {
        var originalScaleX = SELECTED.scale._x;
        var originalScaleY = SELECTED.scale._y;
        var originalScaleZ = SELECTED.scale._z;
        if (x === '' || x <= 0) {
            x = scaleBeforeTransformX;
        }
        if (y === '' || y <= 0) {
            y = scaleBeforeTransformY;
        }
        if (z === '' || z <= 0) {
            z = scaleBeforeTransformZ;
        }
        SELECTED.scale.enteredX = x;
        SELECTED.scale.enteredY = y;
        SELECTED.scale.enteredZ = z;
        SELECTED.scale.set(
            (originalScaleX * x) || scaleBeforeTransformX, (originalScaleY * y) || scaleBeforeTransformY, (originalScaleZ * z) || scaleBeforeTransformZ
        );
        SELECTED.outlineMesh.scale.set(
            (originalScaleX * x) || scaleBeforeTransformX, (originalScaleY * y) || scaleBeforeTransformY, (originalScaleZ * z) || scaleBeforeTransformZ
        );
        SELECTED.scale.locked = isLocked;
        SELECTED.plane_boundary = planeBoundary(SELECTED);

        reactSrc.setState({
            modelSelected: SELECTED.uuid ? SELECTED : null
        });

        if (center) {
            SELECTED.plane_boundary = planeBoundary(SELECTED);
            groundIt(SELECTED);
            checkOutOfBounds(SELECTED);
            render();
        }
    }

    function setSize(x, y, z, isLocked) {
        var sx = Math.round(x / SELECTED.size.originalX * 1000) / 1000,
            sy = Math.round(y / SELECTED.size.originalY * 1000) / 1000,
            sz = Math.round(z / SELECTED.size.originalZ * 1000) / 1000,
            _center = true;

        setScale(sx, sy, sz, isLocked, _center);

        SELECTED.size.x = x;
        SELECTED.size.y = y;
        SELECTED.size.z = z;
    }

    function setRotateMode() {
        setMode('rotate');
    }

    function setScaleMode() {
        setMode('scale');
    }

    function setMode(mode) {
        removeFromScene('TransformControl');
        transformControl.setMode(mode);
        scene.add(transformControl);
        render();
    }

    function setAdvanceParameter(settings) {
        slicer.setParameter('advancedSettings', settings.custom).then(function(result, errors) {
            if(errors.length > 0) {
                AlertActions.showPopupError(_id, errors.join('\n'));
            }
        });
        blobExpired = true;
    }

    function setParameter(name, value) {
        blobExpired = true;
        return slicer.setParameter(name, value)
    }

    function setRotation(x, y, z, needRender, src) {
        src = src || SELECTED;
        var _x = parseInt(x) || 0,
            _y = parseInt(y) || 0,
            _z = parseInt(z) || 0;
        src.rotation.enteredX = x;
        src.rotation.enteredY = y;
        src.rotation.enteredZ = z;
        src.rotation.x = degreeToRadian(_x);
        src.rotation.y = degreeToRadian(_y);
        src.rotation.z = degreeToRadian(_z);
        src.outlineMesh.rotation.x = degreeToRadian(_x);
        src.outlineMesh.rotation.y = degreeToRadian(_y);
        src.outlineMesh.rotation.z = degreeToRadian(_z);

        if (needRender) {
            reactSrc.setState({
                modelsrc: src.uuid ? src : null
            });
            src.plane_boundary = planeBoundary(src);
            groundIt(src);
            checkOutOfBounds(src);
            render();
        }
    }

    function setImportWindowPosition() {
        if (document.getElementsByClassName('arrowBox').length > 0) {
            var position = toScreenPosition(referenceMeshes[0], camera),
                importWindow = document.getElementsByClassName('arrowBox')[0],
                importWindowWidth = parseInt($(importWindow).css('width').replace('px', '')),
                importWindowHeight = parseInt($(importWindow).css('height').replace('px', ''));

            $('.arrowBox').css({
                'top': position.y - importWindowHeight - 20,
                'left': position.x - importWindowWidth / 2
            });
        }
    }

    function setObjectDialoguePosition(obj) {
        var o = obj || SELECTED;

        if (!$.isEmptyObject(o)) {

            var box = new THREE.BoundingBoxHelper(o, s.colorSelected),
                position = toScreenPosition(o, camera),
                cameraDistance = 0,
                objectDialogueDistance = 0;

            box.update();
            cameraDistance = 320 / Math.sqrt(Math.pow(camera.position.x, 2) + Math.pow(camera.position.y, 2) + Math.pow(camera.position.z, 2));
            objectDialogueDistance = cameraDistance * 1.2 * Math.sqrt(Math.pow(box.box.size().x, 2) + Math.pow(box.box.size().y, 2)) + 15;
            objectDialogueDistance = parseInt(objectDialogueDistance);

            reactSrc.setState({
                modelSelected: o,
                openObjectDialogue: true
            }, function() {
                var objectDialogue = document.getElementsByClassName('object-dialogue')[0],
                    objectDialogueWidth = parseInt($(objectDialogue).width()),
                    objectDialogueHeight = parseInt($(objectDialogue).height()),
                    leftOffset = parseInt(position.x),
                    topOffset = (parseInt(position.y) - objectDialogueHeight / 2),
                    marginTop = container.offsetHeight / 2 - position.y;

                var rightLimit = container.offsetWidth / 2 - leftPanelWidth - objectDialogueWidth,
                    topLimit = container.offsetHeight / 2 - objectDialogueHeight / 2;

                if (objectDialogueDistance > rightLimit) {
                    objectDialogueDistance = rightLimit;
                }

                if (marginTop > topLimit) {
                    topOffset = 0;
                }

                reactSrc.setState({
                    objectDialogueStyle: {
                        'left': leftOffset + 'px',
                        'top': topOffset + 'px',
                        'margin-left': objectDialogueDistance + 'px'
                    }
                });

                reactSrc.state.mode === 'rotate' ? $('.scale-content').hide() : $('.rotate-content').hide();
            });
        }
    }

    function setCameraPosition(refCamera) {
        camera.position.copy(refCamera.position.add(panningOffset));
        camera.rotation.copy(refCamera.rotation);

        render();
        setObjectDialoguePosition();
        setImportWindowPosition();
    }

    // Main Functions ---

    // select the specified object, will calculate out-of-bounds and change color accordingly
    function selectObject(obj) {
        SELECTED = obj || {};

        if (!$.isEmptyObject(obj)) {

            objects.forEach(function(o) {
                o.outlineMesh.visible = false;
            });

            if(obj.outlineMesh) {
                obj.outlineMesh.visible = true;
            }
            setObjectDialoguePosition(obj);

            transformControl.attach(obj);
            transformControl.name = 'TransformControl';

            scaleBeforeTransformX = obj.scale.x;
            scaleBeforeTransformY = obj.scale.y;
            scaleBeforeTransformZ = obj.scale.z;

            if(reactSrc.state.mode === 'rotate') {
                setRotateMode();
            }
            else {
                setScaleMode();
            }
        }
        else {
            transformMode = false;
            removeFromScene('TransformControl');
            _removeAllMeshOutline();
            reactSrc.setState({ openObjectDialogue: false });
        }

        render();
    }

    function alignCenter() {
        if (!$.isEmptyObject(SELECTED)) {
            var reference = getReferenceDistance(SELECTED);
            SELECTED.position.x -= reference.x;
            SELECTED.position.y -= reference.y;
            SELECTED.position.z -= reference.z;
            blobExpired = true;

            checkOutOfBounds(SELECTED);
            render();
        }
    }

    function groundIt(mesh) {
        if (!$.isEmptyObject(mesh)) {
            var reference = getReferenceDistance(mesh);
            mesh.position.z -= reference.z;
            if(mesh.outlineMesh) {
                mesh.outlineMesh.position.z -= reference.z;
            }
            blobExpired = true;
        }
    }

    function setDefaultFileName() {
        if(objects.length) {
            defaultFileName = objects[0].fileName;
            defaultFileName = defaultFileName.split('.');
            defaultFileName.pop();
            defaultFileName = defaultFileName.join('.');
        }
    }

    function removeSelected() {
        if (SELECTED) {
            var index;
            scene.remove(SELECTED.outlineMesh);
            scene.remove(SELECTED);
            outlineScene.remove(SELECTED.outlineMesh);
            index = objects.indexOf(SELECTED);
            if (index > -1) {
                objects.splice(index, 1);
            }

            //  model in backend
            slicer.delete(SELECTED.uuid, function(result) {
                if(result.status.toUpperCase() === DeviceConstants.ERROR) {
                    AlertActions.showPopupError('slicer', result.error);
                }
            });

            transformControl.detach(SELECTED);
            selectObject(null);
            render();

            setDefaultFileName();

            if(objects.length === 0) {
                reactSrc.setState({
                    openImportWindow: true,
                    hasObject: false
                }, function() {
                    setImportWindowPosition();
                });
            }
        }
    }

    function duplicateSelected() {
        if(SELECTED) {
            var mesh = new THREE.Mesh(SELECTED.geometry, SELECTED.material);
            mesh.up = new THREE.Vector3(0, 0, 1);

            slicer.duplicate(SELECTED.uuid, mesh.uuid).then(function(result) {
                if(result.status.toUpperCase() === DeviceConstants.OK) {

                    Object.assign(mesh.scale, SELECTED.scale);
                    mesh.rotation.enteredX = SELECTED.rotation.enteredX;
                    mesh.rotation.enteredY = SELECTED.rotation.enteredY;
                    mesh.rotation.enteredZ = SELECTED.rotation.enteredZ;
                    mesh.rotation.x = SELECTED.rotation.x;
                    mesh.rotation.y = SELECTED.rotation.y;
                    mesh.rotation.z = SELECTED.rotation.z;

                    mesh.name = 'custom';
                    mesh.plane_boundary = planeBoundary(mesh);

                    addSizeProperty(mesh);
                    groundIt(mesh);
                    createOutline(mesh);

                    scene.add(mesh);
                    outlineScene.add(mesh.outlineMesh);
                    objects.push(mesh);

                    render();
                }
                else {
                    AlertActions.showPopupError('duplicateError', result.error);
                }
            });
        }
    }

    function addPoint(x, y, z, r) {
        var geometry = new THREE.SphereGeometry(r || 5, 32, 32);
        var material = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.3
        });
        var sphere = new THREE.Mesh(geometry, material);
        sphere.position.x = x;
        sphere.position.y = y;
        sphere.position.z = z;
        scene.add(sphere);
    }



    function planeBoundary(sourceMesh) {
        // ref: http://www.csie.ntnu.edu.tw/~u91029/ConvexHull.html#4
        // Andrew's Monotone Chain

        // define Cross product function on 2d plane
        var cross = (function cross(p0, p1, p2) {
            return ((p1.x - p0.x) * (p2.y - p0.y)) - ((p1.y - p0.y) * (p2.x - p0.x));
        });

        // sort the index of each point in stl
        var stl_index = [];
        for (var i = 0; i < sourceMesh.geometry.vertices.length; i += 1) {
          stl_index.push(i);
        }
        stl_index.sort(function(a, b) {
            if (sourceMesh.geometry.vertices[a].y === sourceMesh.geometry.vertices[b].y) {
                return sourceMesh.geometry.vertices[a].x - sourceMesh.geometry.vertices[b].x;
            }
            return sourceMesh.geometry.vertices[a].y - sourceMesh.geometry.vertices[b].y;
        });

        // find boundary
        var boundary = [];

        // compute upper hull
        for (var i = 0; i < stl_index.length; i += 1) {
          while( boundary.length >= 2 && cross(sourceMesh.geometry.vertices[boundary[boundary.length - 2]], sourceMesh.geometry.vertices[boundary[boundary.length - 1]], sourceMesh.geometry.vertices[stl_index[i]]) <= 0){
            boundary.pop();
          }
            boundary.push(stl_index[i]);
        }
        // compute lower hull
        var t = boundary.length + 1;
        for (var i = stl_index.length - 2 ; i >= 0; i -= 1) {
            while( boundary.length >= t && cross(sourceMesh.geometry.vertices[boundary[boundary.length - 2]], sourceMesh.geometry.vertices[boundary[boundary.length - 1]], sourceMesh.geometry.vertices[stl_index[i]]) <= 0){
                boundary.pop();
            }
            boundary.push(stl_index[i]);
        }
        // delete redundant point(i.e., starting point)
        boundary.pop();

        return boundary;
    }

    function checkOutOfBounds(sourceMesh) {
        if (!$.isEmptyObject(sourceMesh)) {
            sourceMesh.position.isOutOfBounds = sourceMesh.plane_boundary.some(function(v) {
                var vector = sourceMesh.geometry.vertices[v].clone();
                vector.applyMatrix4(sourceMesh.matrixWorld);
                return Math.sqrt(Math.pow(vector.x, 2) + Math.pow(vector.y, 2)) > s.radius;
            });

            sourceMesh.outlineMesh.material.color.setHex(sourceMesh.position.isOutOfBounds ? s.colorOutside : s.colorSelected);

            var hasOutOfBoundsObject = objects.some(function(o) {
                return o.position.isOutOfBounds;
            });

            reactSrc.setState({
                hasOutOfBoundsObject: hasOutOfBoundsObject
            });
        }
    }

    function sendGCodeParameters() {
        var d = $.Deferred();
        _syncObjectParameter(objects, 0, function() {
            d.resolve('');
        });
        return d.promise();
    }

    function downloadGCode(fileName) {
        if(!fileName) {
            fileName = defaultFileName;
        }

        fileName = fileName + '.gcode';

        blobExpired = true;
        selectObject(null);
        var d = $.Deferred();
        if(objects.length > 0) {
            if (!blobExpired) {
                d.resolve(saveAs(responseBlob, fileName));
            } else {
                getGCode().then(function(blob) {
                    if (blob instanceof Blob) {
                        _setProgressMessage('');
                        d.resolve(saveAs(blob, fileName));
                    }
                });
            }

            return d.promise();
        }
        else {
            d.resolve('');
            return d.promise();
        }
    }

    function downloadFCode(fileName) {
        if(!fileName) {
            fileName = defaultFileName;
        }

        fileName = fileName + '.fc';

        selectObject(null);
        var d = $.Deferred();
        if(objects.length > 0) {
            if (!blobExpired) {
                d.resolve(saveAs(responseBlob, fileName));
            } else {
                getFCode().then(function(blob) {
                    if (blob instanceof Blob) {
                        _setProgressMessage('');
                        d.resolve(saveAs(blob, fileName));
                    }
                });
            }

            return d.promise();
        }
        else {
            d.resolve('');
            return d.promise();
        }
    }

    function getBlobFromScene() {
        var ccp = camera.position.clone(),
            ccr = camera.rotation.clone(),
            d = $.Deferred(),
            ol = _getCameraLook(camera);

        // camera.position.set(originalCameraPosition.x, originalCameraPosition.y, originalCameraPosition.z);
        camera.position.set(0, -215, 60);
        camera.rotation.set(originalCameraRotation.x, originalCameraRotation.y, originalCameraRotation.z, originalCameraRotation.order);
        camera.lookAt(new THREE.Vector3(0,300,0));
        render();

        renderer.domElement.toBlob(function(blob) {
            camera.position.set(ccp.x, ccp.y, ccp.z);
            camera.rotation.set(ccr.x, ccr.y, ccr.z, ccr.order);
            camera.lookAt(ol);
            render();
            d.resolve(blob);
        });

        return d.promise();
    }

    function removeFromScene(name) {
        for (var i = scene.children.length - 1; i >= 0; i--) {
            if (scene.children[i].name === name) {
                scene.children.splice(i, 1);
            }
        }
    }

    function updateFromScene(name) {
        for (var i = scene.children.length - 1; i >= 0; i--) {
            if (scene.children[i].name === name) {
                scene.children[i].update();
            }
        }
    }

    function togglePreview(isOn) {
        if (objects.length === 0) {
            return;
        } else {
            isOn ? _showPreview() : _hidePreview();
        }
    }

    function changePreviewLayer(layerNumber) {
        for (var i = 1; i < previewScene.children.length; i++) {
            previewScene.children[i].visible = i - 1 < layerNumber;
        }
        render();
    }

    function executePrint(serial) {
        var d = $.Deferred();
        selectObject(null);
        if(objects.length === 0) {
            d.resolve('');
            return d.promise();
        }
        var go = function(blob) {
            var control_methods = printerController(serial);
            control_methods.upload(blob.size, blob);
            d.resolve(blob);
        };

        if (!blobExpired) {
            go(responseBlob);
        }
        else {
            getFCode().then(function(result) {
                if (result instanceof Blob) {
                    go(result);
                }
            });
        }
        return d.promise();
    }

    function updateOrbitControl() {
        setObjectDialoguePosition();
        render();
        setImportWindowPosition();
        reactSrc.setState({
            camera: camera
        });
        panningOffset = camera.position.clone().sub(camera.position.raw);

        if(scene.cameraLight) {
            scene.cameraLight.position.copy(camera.position);
        }
    }

    function clearSelection() {
        selectObject(null);
    }

    function render() {
        if (!$.isEmptyObject(SELECTED)) {
            updateFromScene('TransformControl');
        }
        // renderer.render(previewMode ? previewScene : scene, camera);
        renderer.clear();
        renderer.render( outlineScene, camera );

        renderer.clearDepth();
        renderer.render(previewMode ? previewScene : scene, camera);
    }

    function addSizeProperty(obj) {
        if (!$.isEmptyObject(obj)) {
            var boundingBox = new THREE.BoundingBoxHelper(obj);
            boundingBox.update();
            obj.size = boundingBox.box.size();
            obj.size.enteredX = boundingBox.box.size().x;
            obj.size.enteredY = boundingBox.box.size().y;
            obj.size.enteredZ = boundingBox.box.size().z;
            obj.size.originalX = boundingBox.box.size().x;
            obj.size.originalY = boundingBox.box.size().y;
            obj.size.originalZ = boundingBox.box.size().z;
        }
    }

    // Helper Functions ---

    function degreeToRadian(degree) {
        return (degree / 360 * Math.PI * 2) || 0;
    }

    function radianToDegree(radian) {
        return radian * 180 / Math.PI;
    }

    function updateDegreeWithStep(degree) {
        if (degree === 0) {
            return 0;
        }
        var degreeStep = shiftPressed ? 15 : s.degreeStep;
        return (parseInt(degree / degreeStep) * degreeStep);
    }

    function updateScaleWithStep(scale) {
        // if no decimal after scale precision, ex: 1.1, not 1.143
        if (parseInt(scale * Math.pow(10, s.scalePrecision)) === scale * Math.pow(10, s.scalePrecision)) {
            return scale;
        }
        return (parseInt(scale * Math.pow(10, s.scalePrecision)) + 1) / Math.pow(10, s.scalePrecision);
    }

    function updateObjectSize(src) {
        var boundingBox = new THREE.BoundingBoxHelper(src),
            size;

        boundingBox.update();
        size = boundingBox.box.size();
        src.size.x = size.x;
        src.size.y = size.y;
        src.size.z = size.z;
        src.size.enteredX = src.size.x;
        src.size.enteredY = src.size.y;
        src.size.enteredZ = src.size.z;

        src.rotation.enteredX = updateDegreeWithStep(radianToDegree(src.rotation.x));
        src.rotation.enteredY = updateDegreeWithStep(radianToDegree(src.rotation.y));
        src.rotation.enteredZ = updateDegreeWithStep(radianToDegree(src.rotation.z));

        syncObjectOutline(src);
        setRotation(src.rotation.enteredX, src.rotation.enteredY, src.rotation.enteredZ);

        reactSrc.setState({
            modelSelected: src
        });
    }

    function toScreenPosition(obj, camera) {
        if (!$.isEmptyObject(obj)) {
            var vector = new THREE.Vector3();

            // TODO: need to update this when resize window
            var widthHalf = 0.5 * container.offsetWidth;
            var heightHalf = 0.5 * container.offsetHeight;

            obj.updateMatrixWorld();
            vector.setFromMatrixPosition(obj.matrixWorld);
            vector.project(camera);

            vector.x = (vector.x * widthHalf) + widthHalf;
            vector.y = -(vector.y * heightHalf) + heightHalf;

            return {
                x: vector.x,
                y: vector.y
            };
        }
    }

    function createOutline(mesh) {
        var outlineMaterial = new THREE.MeshBasicMaterial({
            color: s.colorSelected,
            side: THREE.BackSide,
            wireframe: true,
            wireframeLinewidth: 5
        });
        var outlineMesh = new THREE.Mesh(mesh.geometry, outlineMaterial);
        outlineMesh.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
        outlineMesh.scale.set(mesh.scale.x, mesh.scale.y, mesh.scale.z);
        outlineMesh.rotation.set(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z);
        mesh.outlineMesh = outlineMesh;
        outlineScene.add(outlineMesh);

    }

    function syncObjectOutline(src) {
        src.outlineMesh.rotation.set(src.rotation.x, src.rotation.y, src.rotation.z, 'ZYX');
        src.outlineMesh.scale.set(src.scale.x, src.scale.y, src.scale.z);
        render();
    }

    function displayProgress(step, total) {
        if(step === total) {
            ProgressActions.updating(lang.print.uploaded, 80);
        }
    }

    // Private Functions ---

    // sync parameters with server
    function _syncObjectParameter(objects, index, callback) {
        index = index || 0;
        if (index < objects.length) {
            slicer.set(
                objects[index].uuid,
                objects[index].position.x,
                objects[index].position.y,
                objects[index].position.z,
                objects[index].rotation.x,
                objects[index].rotation.y,
                objects[index].rotation.z,
                objects[index].scale.x,
                objects[index].scale.y,
                objects[index].scale.z
            ).then(function(result) {
                if (result.status === 'error') {
                    index = objects.length;
                }
                if (index < objects.length) {
                    _syncObjectParameter(objects, index + 1, callback);
                }
            });
        } else {
            callback();
        }
    }

    function _addShadowedLight(x, y, z, color, intensity) {
        var directionalLight = new THREE.DirectionalLight(color, intensity);
        directionalLight.position.set(x, y, z);

        scene.add(directionalLight);
        directionalLight.castShadow = true;

        var d = 1;
        directionalLight.shadowCameraLeft = -d;
        directionalLight.shadowCameraRight = d;
        directionalLight.shadowCameraTop = d;
        directionalLight.shadowCameraBottom = -d;

        directionalLight.shadowCameraNear = 1;
        directionalLight.shadowCameraFar = 4;

        directionalLight.shadowMapWidth = 1024;
        directionalLight.shadowMapHeight = 1024;

        directionalLight.shadowBias = -0.005;
        directionalLight.shadowDarkness = 0.15;

        directionalLight.shadowCameraVisible = true;
    }

    function _hidePreview() {
        previewMode = false;
        render();
        _setProgressMessage('');
    }

    function _showPreview() {
        selectObject(null);

        var drawPath = function() {
            previewMode = true;
            slicer.getPath().then(function(result) {
                printPath = result;
                _drawPath();
            });
        };

        if (blobExpired) {
            getFCode().then(function(blob) {
                if (blob instanceof Blob) {
                    drawPath();
                }
            });
        } else {
            previewMode = true;
            if (previewScene.children.length <= 1) {
                drawPath();
            } else {
                _showPath();
            }
        }
    }

    function _drawPath() {
        var color,
            g, m, line,
            type;

        previewScene.children.splice(1, previewScene.children.length - 1);
        m = new THREE.LineBasicMaterial({
            color: 0xffffff,
            opacity: 10,
            linewidth: 1,
            vertexColors: THREE.VertexColors
        });

        for (var layer = 0; layer < printPath.length; layer++) {
            g = new THREE.Geometry();
            color = [];

            // with no gradient, but 2x more points
            for (var point = 0; point < printPath[layer].length; point++) {
                type = !!printPath[layer][point + 1] ? printPath[layer][point + 1].t : printPath[layer][point].t;
                color[point] = previewColors[type];
                g.vertices.push(new THREE.Vector3(
                    printPath[layer][point].p[0],
                    printPath[layer][point].p[1],
                    printPath[layer][point].p[2]
                ));
            }

            g.colors = color;
            line = new THREE.Line(g, m);
            line.name = 'line';
            previewScene.add(line);
        }

        reactSrc.setState({
            previewLayerCount: previewScene.children.length - 1
        });
        _showPath();
    }

    function _showPath() {
        render();
        _setProgressMessage('');
    }

    function _setProgressMessage(message) {
        reactSrc.setState({
            progressMessage: message
        });
    }

    function _removeAllMeshOutline() {
        objects.forEach(function(obj) {
            obj.outlineMesh.visible = false;
        });
    }

    function _getCameraLook(camera) {
        var vector = new THREE.Vector3(0, 0, -1);
        vector.applyEuler(camera.rotation, camera.eulerOrder);
        return vector;
    }

    function send(command) {
        slicer.send(command);
    }

    return {
        init                : init,
        appendModel         : appendModel,
        setRotation         : setRotation,
        setScale            : setScale,
        alignCenter         : alignCenter,
        removeSelected      : removeSelected,
        duplicateSelected   : duplicateSelected,
        sendGCodeParameters : sendGCodeParameters,
        setSize             : setSize,
        downloadGCode       : downloadGCode,
        downloadFCode       : downloadFCode,
        setRotateMode       : setRotateMode,
        setScaleMode        : setScaleMode,
        setAdvanceParameter : setAdvanceParameter,
        setParameter        : setParameter,
        getGCode            : getGCode,
        getFCode            : getFCode,
        getModelCount       : getModelCount,
        togglePreview       : togglePreview,
        changePreviewLayer  : changePreviewLayer,
        executePrint        : executePrint,
        setCameraPosition   : setCameraPosition,
        clearSelection      : clearSelection,
        send                : send
    };
});
