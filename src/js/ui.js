/* ==========================================================
 * UI (VK Offline Chrome app)
 * https://github.com/1999/vkoffline
 * ==========================================================
 * Copyright 2013 Dmitry Sorin <info@staypositive.ru>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ========================================================== */

document.addEventListener("click", function (e) {
	var matchesSelectorFn = (Element.prototype.webkitMatchesSelector || Element.prototype.matchesSelector);
	var routes = {
		// закрытие окна уведомления
		"section.result > span.close": function (target, evt) {
			target.parentNode.remove();
		},
		// открытие контакта
		"#content > section.left.contacts-container > section[data-uid]": function (target, evt) {
			var uid = target.data("uid");
			var fioSection = $(target, "section.fio");
			var fio = fioSection.text();

			this.view("showContact", {
				uiType: "partial",
				headers: {
					left: [
						{"type" : "text", "name" : fio},
						{"type" : "icon", "name" : "write", "title" : chrome.i18n.getMessage("writeMessage")}
					],
					right: [
						{"type" : "text", "name" : chrome.i18n.getMessage("correspondence")}
					]
				}
			}, [uid]);
		},
		// открытие чата
		"#content > section.right.dialogs-container > section[data-id]": function (target, evt) {
			var dialogId = target.data("id");
			var subjElem = $(target, "span.text span.subj");
			var subject = subjElem ? subjElem.text() : "";

			this.view("chat", {
				uiType: "partial",
				headers: {
					right: [
						{"type" : "text", "name" : subject},
						{"type" : "icon", "name" : "back", "title" : chrome.i18n.getMessage("backToDialogsList")},
						{"type" : "icon", "name" : "search", "title" : chrome.i18n.getMessage("searchMail")},
						{"type" : "icon", "name" : "print", "title" : chrome.i18n.getMessage("printCorrespondence")}
					]
				}
			}, [dialogId]);
		},
		// открытие сообщения из переписки
		"#content > section.right.thread-container > section.half": function (target, evt) {
			var msgId = target.data("mid");
			this._drawOpenMessage(msgId);
		},
		// отметка сообщения как важного
		"#content > section.right span.important": function (target, evt) {
			var self = this;
			var closestParent = target.closestParent("section.open") || target.closestParent("section.msg"),
				msgId = closestParent.data("mid"),
				tagListItemCounter = $("#content > section.left.manage-mail li[data-tid='" + self.CacheManager.tags.important + "'] span"),
				counterValue;

			if (target.hasClass("active")) {
				chrome.extension.sendMessage({
					action: "unmarkMessageTag",
					mid: msgId,
					tagId: self.CacheManager.tags.important
				}, function (unmarked) {
					if (unmarked) {
						target.removeClass("active").removeAttr("title").removeData();

						// при необходимости обновляем счетчики
						if (self.lastShownView[0] === "messagesOfType") {
							counterValue = parseInt(tagListItemCounter.text(), 10);
							tagListItemCounter.text(counterValue - 1);
						}
					}
				});
			} else {
				chrome.extension.sendMessage({
					action: "markMessageTag",
					mid: msgId,
					tagId: self.CacheManager.tags.important
				}, function (marked) {
					if (marked) {
						target.addClass("active").attr("title", chrome.i18n.getMessage("importantMessage"));

						// при необходимости обновляем счетчики
						if (self.lastShownView[0] === "messagesOfType") {
							counterValue = parseInt(tagListItemCounter.text(), 10);
							tagListItemCounter.text(counterValue + 1);
						}
					}
				});
			}

			chrome.extension.sendMessage({
				action: "useImportantTag",
				type: "mark"
			});
		},
		// печать сообщения
		"#content > section.right.thread-container > section.open span.print": function (target, evt) {
			var msgSection = target.closestParent("section.open"),
				msgId = msgSection.data("mid"),
				uid = $(msgSection, "img").data("uid");

			chrome.tabs.create({
				url: App.resolveURL("print.html?mid=" + msgId + "&uid=" + uid)
			});
		},
		// ответ на сообщение
		"#content > section.right.thread-container > section.open span.reply": function (target, evt) {
			var openSection = target.closestParent("section.open"),
				threadContainer = $("#content > section.right.thread-container"),
				dialogId = openSection.data("did"),
				msgId = openSection.data("mid"),
				fakeArea = $(openSection, "textarea.fake");

			if (fakeArea)
				fakeArea.remove();

			if (dialogId.length)
				threadContainer.data("dialogId", dialogId);

			var msgSection = $(threadContainer, "section[data-mid='" + msgId + "']");
			var replyAreaForm = $(threadContainer, "form.reply");

			if (replyAreaForm) {
				if (msgSection.nextElementSibling === replyAreaForm) { // попытка открыть форму в том же месте
					replyAreaForm.remove();
				} else {
					msgSection.after(replyAreaForm);
					replyAreaForm.scrollIntoView();

					var textArea = $(replyAreaForm, "textarea");
					if (textArea) {
						textArea.focus();
					}
				}

				return;
			}

			replyAreaForm = this._drawMessageSendForm("simple");
			msgSection.after(replyAreaForm);
		},
		// нажатие на фейковую форму ответа
		"#content > section.right.thread-container > section.open textarea.fake": function (target, evt) {
			var openSection = target.closestParent("section.open");
			$(openSection, "span.reply").click();
		},
		// показ вложений
		"#content > section.right.chat-container section.attach > section.attachment.hidden": function (target, evt) {
			var self = this;
			var msgSection = target.closestParent("section.msg");
			var msgId = msgSection.data("mid");
			var requestData = JSON.parse(target.data("info"));
			var availableWidth = msgSection.offsetWidth;

			if (target.hasClass("loading"))
				return;

			target.addClass("loading");

			// делаем доп. запросы к API для получения прямых ссылок на вложения
			switch (requestData[0]) {
				case "photo":
					var imgElem = $(target, "img");

					if (requestData.length === 2) {
						var image = new Image();
						image.onload = function () {
							target.removeClass("hidden");

							var imgAspect = image.width / image.height;
							var imgWidth = Math.min(availableWidth, image.width);

							imgElem.attr({
								width: imgWidth,
								height: imgWidth / imgAspect,
								src: requestData[1]
							});
						};

						image.src = requestData[1];
					} else {
						chrome.extension.sendMessage({
							action: "getPhotoById",
							ownerId: requestData[1],
							id: requestData[2],
							mid: msgId
						}, function (photoInfo) {
							if (!photoInfo)
								return;

							target.removeClass("hidden");

							var imgAspect = photoInfo.width / photoInfo.height;
							var imgWidth = Math.min(availableWidth, photoInfo.width);

							imgElem.attr({
								width: imgWidth,
								height: imgWidth / imgAspect,
								src: Utils.misc.searchBiggestImage(photoInfo)
							});
						});
					}

					break;

				case "audio":
					chrome.extension.sendMessage({
						action: "getAudioById",
						ownerId: requestData[1],
						id: requestData[2],
						mid: msgId
					}, function (audioInfo) {
						if (!audioInfo)
							return;

						target.removeClass("hidden");

						$(target, "span.description").text(audioInfo.artist + " - " + audioInfo.title);
						$(target, "audio").attr("src", audioInfo.url);
					});

					break;

				case "video":
					chrome.extension.sendMessage({
						action: "getVideoById",
						ownerId: requestData[1],
						id: requestData[2],
						mid: msgId
					}, function (videoInfo) {
						if (!videoInfo)
							return;

						target.removeClass("hidden");
						var descriptionText = (videoInfo.description.indexOf(videoInfo.title) === -1) ? videoInfo.title + "<br>" + videoInfo.description : videoInfo.description;

						$(target, "iframe").attr("src", videoInfo.player);
						$(target, "span.description").html(Utils.string.replaceLinks(descriptionText.replace(/(<br>){2,}/gm, "<br>")));
					});

					break;

				case "doc":
					chrome.extension.sendMessage({
						action: "getDocById",
						ownerId: requestData[1],
						id: requestData[2],
						mid: msgId
					}, function (fileInfo) {
						if (!fileInfo)
							return;

						target.removeClass("hidden");
						var regex = new RegExp(fileInfo.ext + "$");
						var fileName = (regex.test(fileInfo.title)) ? fileInfo.title : fileInfo.title + "." + fileInfo.ext;

						$(target, "a").attr({
							href: fileInfo.url,
							download: fileName
						}).text(fileInfo.title);

						var descriptionText = Utils.string.humanFileSize(fileInfo.size) + ", " + chrome.i18n.getMessage("fileType") + ": " + fileInfo.ext.toUpperCase();
						$(target, "span.description").text(descriptionText);
					});

					break;

				case "geopoint":
					chrome.extension.sendMessage({
						action: "getGeopointById",
						mid: msgId
					}, function (pointInfo) {
						if (!pointInfo)
							return;

						target.removeClass("hidden");
						self._drawGeoPointAsync(target.id, pointInfo[0], pointInfo[1]);

						target.scrollIntoView();
					});

					break;
			}
		},
		// восстановление сообщения
		"#content > section.right.thread-container > section.open span.restore": function (target, evt) {
			var self = this;
			var msgSection = target.closestParent("section.open");
			var leftSection = $("#content > section.left");
			var msgId = msgSection.data("mid");

			Utils.async.parallel({
				// снимаем отметку с сообщения "удаленное" в БД
				db: function (callback) {
					chrome.extension.sendMessage({
						action: "unmarkMessageTag",
						mid: msgId,
						tagId: self.CacheManager.tags.trash
					}, function (ok) {
						callback((ok) ? null : "Update database fail");
					});
				},
				// восстанавливаем на сервере
				server: function (callback) {
					chrome.extension.sendMessage({
						action: "serverRestoreMessage",
						mid: msgId
					}, function (ok) {
						callback();
					});
				}
			}, function (err) {
				if (err)
					throw new Error(err);

				msgSection.remove();

				// при необходимости обновляем счетчики
				if (self.lastShownView[0] !== "messagesOfType")
					return;

				// обновление счетчика корзины
				var tagListItemCounter = $("#content > section.left.manage-mail li[data-tid='" + self.CacheManager.tags.trash + "'] span");
				var counterValue = parseInt(tagListItemCounter.text(), 10);
				tagListItemCounter.text(counterValue - 1);

				// необходимо обновить все счетчики тэгов для сообщения
				chrome.extension.sendMessage({action: "getMessageInfo", mid: msgId}, function (msgInfo) {
					var counterValue;

					// добавляем стартовые метки-папки
					App.INIT_TAGS.forEach(function (tagName) {
						var tagId = self.CacheManager.tags[tagName]
						if ((tagName === "trash") || ((msgInfo.tags & tagId) === 0))
							return;

						var counterElem = $(leftSection, "li[data-tid='" + tagId + "'] > span.total");
						if (counterElem) {
							counterValue = parseInt(counterElem.text(), 10) + 1;
							counterElem.text(counterValue);
						}
					});
				});
			});
		},
		// удаление сообщения
		"#content > section.right.thread-container > section.open span.delete": function (target, evt) {
			var self = this;
			var msgSection = target.closestParent("section.open");
			var msgId = msgSection.data("mid");
			var leftSection = $("#content > section.left");
			var isTrashFolderContents = (leftSection.hasClass("manage-mail") && parseInt($(leftSection, "li.active").data("tid"), 10) === self.CacheManager.tags.trash);
			var serverToo = (self.SettingsManager.DeleteUser !== 0);

			if (isTrashFolderContents) {
				if (confirm(chrome.i18n.getMessage("deleteMessageForever"))) {
					chrome.extension.sendMessage({action: "deleteMessageForever", mid: msgId, serverToo: serverToo}, function () {
						msgSection.remove();
					});
				}

				return;
			}

			Utils.async.parallel({
				// помечаем сообщение как удаленное в БД
				db: function (callback) {
					chrome.extension.sendMessage({
						action: "markMessageTag",
						mid: msgId,
						tagId: self.CacheManager.tags.trash
					}, function (ok) {
						callback((ok) ? null : "Update database fail");
					});
				},
				// удаляем на сервере
				server: function (callback) {
					if (self.SettingsManager.DeleteUser !== 0) {
						chrome.extension.sendMessage({
							action: "serverDeleteMessage",
							mid: msgId
						}, function (ok) {
							callback((ok) ? null : "Server delete fail");
						});
					} else {
						callback();
					}
				}
			}, function (err) {
				if (err)
					throw new Error(err);

				var openPrevAfterDelete = (msgSection !== msgSection.parentNode.firstElementChild && msgSection.previousElementSibling.hasClass("open") === false);
				var sectionToOpen = (openPrevAfterDelete && msgSection.previousElementSibling.hasClass("half")) ? msgSection.previousElementSibling : $("#fold");
				var tagListItemCounter = $("#content > section.left.manage-mail li[data-tid='" + self.CacheManager.tags.trash + "'] span");

				msgSection.remove();
				if (openPrevAfterDelete) {
					sectionToOpen.scrollIntoView();
					sectionToOpen.click();
				}

				// при необходимости обновляем счетчики
				if (self.lastShownView[0] !== "messagesOfType")
					return;

				// обновление счетчика корзины
				var counterValue = parseInt(tagListItemCounter.text(), 10);
				tagListItemCounter.text(counterValue + 1);

				// необходимо обновить все счетчики тэгов для сообщения
				chrome.extension.sendMessage({action: "getMessageInfo", mid: msgId}, function (msgInfo) {
					var counterValue;

					// добавляем стартовые метки-папки
					App.INIT_TAGS.forEach(function (tagName) {
						var tagId = self.CacheManager.tags[tagName];
						if ((tagName === "trash") || ((msgInfo.tags & tagId) === 0))
							return;

						var counterElem = $(leftSection, "li[data-tid='" + tagId + "'] > span.total");
						if (counterElem) {
							counterValue = parseInt(counterElem.text(), 10) - 1;
							counterElem.text(counterValue);
						}
					});
				});
			});
		},
		// открытие сообщений определенного типа
		"#content > section.left.manage-mail li[data-tid]": function (target, evt) {
			var tagId = parseInt(target.data("tid"), 10);
			var containerSection = target.closestParent("#content > section.left");

			$$(containerSection, "li[data-tid]").each(function () {
				if (target === this) {
					this.addClass("active");
				} else {
					this.removeClass("active");
				}
			});

			this.view("messagesOfType", {
				uiType: "partial",
				headers: {
					right: [
						{"type" : "text", "name" : "..."},
						{"type" : "icon", "name" : "list", "title" : chrome.i18n.getMessage("correspondenceManagement")},
						{"type" : "icon", "name" : "search"}
					]
				}
			}, [tagId]);
		}
	};

	var elem;
	var selectedRoute;

	stuff:
	for (var route in routes) {
		elem = e.target;
		while (elem && elem !== document.documentElement) {
			if (matchesSelectorFn.call(elem, route)) {
				selectedRoute = route;
				break stuff;
			}

			elem = elem.parentNode;
		}
	}

	if (!selectedRoute)
		return;

	routes[selectedRoute].call(AppUI, elem, e);
	e.stopImmediatePropagation();
}, false);

document.addEventListener("submit", function (e) {
	var matchesSelectorFn = (Element.prototype.webkitMatchesSelector || Element.prototype.matchesSelector);
	var form = e.target;
	var self = AppUI;

	// прерываем submit
	e.preventDefault();

	var routes = {
		// UI:errorSend
		"#content > section.one form": function () {
			var sendBtn = $(form, "button[type='submit']").attr("disabled", true).text(Utils.string.ucfirst(chrome.i18n.getMessage("pleaseWait")) + "...");

			chrome.permissions.request({
				permissions: ["management", "clipboardWrite"]
			}, function (granted) {
				if (!granted) {
					var warningContents = Templates.render("errorSendWarning", {
						mustGrantManagement: chrome.i18n.getMessage("youMustGrantAccessManagement")
					});

					var btnText = Utils.string.ucfirst(chrome.i18n.getMessage("sendMessageButtonTitle"));
					sendBtn.removeAttr("disabled").text(btnText).before(warningContents);

					return;
				}

				Utils.async.parallel({
					extensions: function (callback) {
						try {
							chrome.management.getAll(function (infoArray) {
								var extensionsData = [];
								infoArray.forEach(function (extensionInfo) {
									var data = [
										"[" + ((extensionInfo.isApp) ? "app" : "ext") + "] " + extensionInfo.name + " v" + extensionInfo.version,
										"enabled: " + extensionInfo.enabled,
										"id: " + extensionInfo.id,
										"homepage: " + extensionInfo.homepageUrl,
										"permissions: " + Array.prototype.concat(extensionInfo.permissions).concat(extensionInfo.hostPermissions)
									].join(", ");

									extensionsData.push({text: data});
								});

								callback(null, extensionsData);
							});
						} catch (e) {
							// https://code.google.com/p/chromium/issues/detail?id=125706
							callback();
						}
					},
					log: function (callback) {
						chrome.extension.sendMessage({action: "collectLogData"}, function (data) {
							var output = data.map(function (logString) {
								return {text: logString};
							});

							callback(null, output);
						});
					}
				}, function (err, results) {
					var resultMessageContents = Templates.render("errorSendFormResult", {
						descriptionText: form.elements.text.value,
						chromeVersion: form.elements.info.value,
						extensionsList: (results.extensions) ? results.extensions : ["Exception #125706"],
						log: results.log,
						buttonText: chrome.i18n.getMessage("errorSendFormCopyButtonText")
					});

					var sectionOne = $("#content > section.one");
					$(sectionOne, "form").remove();
					sectionOne.append(resultMessageContents);

					var copyTextBtn = $(sectionOne, "button");
					copyTextBtn.bind("click", function () {
						// выделяем текст в section.pre
						var range = document.createRange();
						range.selectNode($(sectionOne, "section.pre"));
						window.getSelection().addRange(range);

						document.execCommand("copy");
						this.attr("disabled", true).text(chrome.i18n.getMessage("copiedToClipboard"));
					});

					sectionOne.scrollTop = 0;
				});
			});
		},
		// settings
		"#content > section.settings-container form": function () {
			Array.prototype.forEach.call(form.elements, function (elem) {
				var itemName = elem.attr("name"),
					itemType = elem.attr("type"),
					itemValue = elem.val();

				if (!itemName)
					return;

				switch (itemType) {
					case "range" :
						// такой странный код используется потому что в value из input[type="range"] с min=0, max=1
						// содержится не 0.7, а 0.700000001 итд. (mac, chrome19)
						self.SettingsManager[itemName] = (itemName !== "SoundLevel")
							? itemValue
							: itemValue / 10;
						
						break;

					case "radio" :
						if (elem.checked) {
							self.SettingsManager[itemName] = itemValue;
						}

						break;
				}
			});

			var saveBtn = $(form, "button[type='submit']").text(chrome.i18n.getMessage("saveBtnClicked")).attr("disabled", true);
			window.setTimeout(function () {
				saveBtn.removeAttr("disabled").text(chrome.i18n.getMessage("saveBtn"));
			}, 3000);
		},
		// send message
		"#content form.reply": function () {
			var self = this;
			var sendObj = {action: "sendMessage"};
			var dataContainer = $("#content > section.right");
			var saveMessageKey = "message_" + this.AccountsManager.currentUserId + "_" + dataContainer.data("dialogId");
			var isChat = dataContainer.hasClass("chat-container");
			var form = $(dataContainer, "form.reply");
			var face2face = form.hasClass("face2face");

			var attachmentsUploaded = [];
			var pleaseWaitText = Utils.string.ucfirst(chrome.i18n.getMessage("pleaseWait")) + "...";
			var captchaSection = $(form, "section.captcha:not(:empty)");
			var msgText;

			var sendFn = function() {
				chrome.extension.sendMessage(sendObj, function (data) {
					var sentResultCode = data[0];
					var sentResultData = data[1];

					switch (sentResultCode) {
						case 0 : // ok
							var closeBtn, infoSection, closeTimeoutId;

							// останавливаем таймаут записи в LS
							var timeoutId = form.data("timeoutId");
							if (timeoutId) {
								window.clearTimeout(timeoutId);
								form.removeData("timeoutId");
							}

							// очищаем сохраненный текст сообщения
							StorageManager.remove(saveMessageKey);

							if (isChat) {
								// восстанавливаем активность кнопок
								$$(form, "button").each(function () {
									this.removeAttr("disabled");

									if (this.hasClass("send")) {
										this.text(Utils.string.ucfirst(chrome.i18n.getMessage("sendMessageButtonTitle")));
									}
								});

								// очищаем вложения
								$$(form, "section.manage.attachments > section.file").remove();

								$(form, "li.attachments span").empty();

								// очищаем textarea
								$(form, "textarea").val("").focus();

								// скроллим ниже
								form.scrollIntoView();
							} else {
								// удаляем кнопки у формы
								$$(form, "button").remove();

								var closeBtn = $("<span>").addClass("close");
								var infoSection = $("<section>").addClass("result", "info").text(chrome.i18n.getMessage("messageSentSuccess")).prepend(closeBtn);

								// устанавливаем форме MID нового сообщения
								form.data("mid", sentResultData.response).prepend(infoSection);

								// удаляем форму, если сообщение от LP-сервера пришло раньше ответа
								if ($(dataContainer, "section[data-mid='" + sentResultData.response + "']"))
									return replyAreaForm.remove();

								var closeTimeoutId = window.setTimeout(function () {
									var dataContainer = $("#content > section.right");
									var form = $(dataContainer, "form.reply");

									if (form) {
										if (form.previousElementSibling)
											form.previousElementSibling.scrollIntoView();

										form.remove();
									}

									if (face2face) {
										var uid = dataContainer.data("dialogId").split("_")[1];

										self.view("showContact", {
											uiType: "partial",
											headers: {
												left: [
													{"type" : "text", "name" : "..."},
													{"type" : "icon", "name" : "write", "title" : chrome.i18n.getMessage("writeMessage")}
												],
												right: [
													{"type" : "text", "name" : chrome.i18n.getMessage("correspondence")}
												]
											}
										}, [uid]);
									}
								}, 3000);
								
								form.data("timeoutId", closeTimeoutId);
							}
							
							break;

						case 1 : // captcha
							var captchaImg = $("<img/>").attr({"width" : 130, "height" : 50, "alt" : "", "src" : sendResultData.img});
							var captchaInputText = $("<input>").attr("placeholder", chrome.i18n.getMessage("typeCaptchaSymbols"));
							$(form, "section.captcha").empty().append([captchaImg, captchaInputText]).data("sid", sendResultData.sid);

							captchaInputText.focus();
							$(form, "button.send").removeAttr("disabled").text(Utils.string.ucfirst(chrome.i18n.getMessage("sendMessageButtonTitle")));

							break;

						case 2 : // access denied
							var closeBtn = $("<span>").addClass("close");
							var infoSection = $("<section>").addClass("result", "warn").text(chrome.i18n.getMessage("accessDeniedWhenSendingMessage")).prepend(closeBtn);

							form.prepend(infoSection);
							$(form, "button.send").removeAttr("disabled").text(Utils.string.ucfirst(chrome.i18n.getMessage("sendMessageButtonTitle")));

							break;

						default : // error
							var closeBtn = $("<span>").addClass("close");
							var infoSection = $("<section>").addClass("result", "error").text(chrome.i18n.getMessage("messageSentFail")).prepend(closeBtn);

							form.prepend(infoSection);
							$(form, "button.send").text(Utils.string.ucfirst(chrome.i18n.getMessage("sendMessageButtonTitle")));

							break;
					}
				});
			};


			if (captchaSection) {
				var captchaValue = $(captchaSection, "input").val();
				if (!captchaValue.length)
					return $(captchaSection, "input").addClass("empty").focus();

				sendObj.sid = captchaSection.data("sid");
				sendObj.key = captchaValue;
			}

			sendObj.attachments = [];
			$$(form, "section.manage.attachments > section.file").each(function () {
				var section = this;
				var attachmentId = section.data("id");

				if (attachmentId.length) {
					sendObj.attachments.push(attachmentId);
				}
			});

			sendObj.to = dataContainer.data("dialogId");
			sendObj.body = $(form, "textarea").val();

			var subjectElem = form.elements.subject;
			if (face2face && subjectElem.val().length)
				sendObj.subject = subjectElem.val();

			$(form, "button.send").text(pleaseWaitText).attr("disabled", true);
			$$(form, "section.result").remove();

			if (self.SettingsManager.AttachGeolocation === 1) {
				navigator.geolocation.getCurrentPosition(function (position) {
					sendObj.coords = position.coords;
					sendFn();
				}, sendFn);
			} else {
				sendFn();
			}
		}
	};

	for (var route in routes) {
		if (matchesSelectorFn.call(form, route)) {
			routes[route].call(AppUI);
			break;
		}
	}
}, false);

var AppUI = {
	Views: {
		// список контактов
		contactsList: function(startFrom) {
			startFrom = startFrom || 0;

			var self = this;
			var leftSection = $("#content > section.left").addClass("loading");
			var searchIcon = $("#content > header.left > span.icon.search");
			var sortType;

			if (startFrom === 0) {
				// при первом вызове привязываем обработчик события onscroll
				leftSection.bind("scroll", function () {
					var moreSection = $(this, "section.more");
					if (!moreSection)
						return;
					
					var goPos = this.scrollHeight - 160;
					if (this.scrollTop + this.clientHeight > goPos) {
						moreSection.click();
					}
				}, true);

				searchIcon.bind("click", function () {
					self.view("searchContact", {
						"uiType" : "partial",
						"headers" : {
							"left" : [
								{"type" : "text", "name" : chrome.i18n.getMessage("searchContact")},
								{"type" : "icon", "name" : "back", "title" : chrome.i18n.getMessage("contactsName")}
							]
						}
					});
				});
			}

			switch (self.SettingsManager.SortContacts) {
				case 0 :
					sortType = "lastdate";
					break;

				case 1 :
					sortType = "messagesnum";
					break;

				case 2 :
					sortType = "alpha";
					break;
			}

			chrome.extension.sendMessage({
				action: "fetchContactList",
				type: sortType,
				totalShown: startFrom
			}, function (contactsData) {
				var contactsList = contactsData[0];
				var total = contactsData[1];
				var contacts = [];
				var moreSection = $(leftSection, "section.more");
				var more, totalShown;

				leftSection.removeClass().addClass("left", "contacts-container").removeData();
				if (moreSection)
					moreSection.remove();

				contactsList.forEach(function (userData, i) {
					var contactObj = self._prepareContactSection(userData);
					contacts.push(contactObj);
				});

				var contactsContents = Templates.render("contactsList", {contacts: contacts});
				leftSection.removeClass("loading").append(contactsContents);

				// добавляем при необходимости кнопку "еще"
				totalShown = $$(leftSection, "section[data-uid]:not(.more)").length;
				if (totalShown < total) {
					var moreText = Utils.string.ucfirst(chrome.i18n.getMessage("more"));
					more = $("<section class='more view'>" + moreText + "</section>").bind("click", function () {
						if (this.hasClass("loading"))
							return;

						this.html("&nbsp;").addClass("loading");
						self.view("contactsList", {}, [totalShown]);
					});

					leftSection.append(more);
				}
			});
		},

		// генерация сообщений об ошибке
		errorSend: function () {
			var oneSection = $("#content > section.one").empty().removeClass().addClass("one", "error-container").removeData();
			var formContents = Templates.render("errorSendForm", {
				warningText: chrome.i18n.getMessage("errorSendFormWarning").replace("%appname%", App.NAME).replace("%email%", '<a href="mailto:' + App.ERROR_EMAIL + '">' + App.ERROR_EMAIL + '</a>'),
				descriptionText: chrome.i18n.getMessage("errorSendFormDescriptionText"),
				infoText: chrome.i18n.getMessage("errorSendFormInfoText").replace("%info%", "<a href='chrome://version'>chrome://version</a>"),
				buttonText: chrome.i18n.getMessage("errorSendFormButtonText")
			});

			oneSection.html(formContents);
		},

		// обучалка для гостей
		tourStep: function (num) {
			var STEPSNUM = 6;
			var self = this;

			var descriptionElems = [];
			chrome.i18n.getMessage("tourStep" + num + "Description").split("|").forEach(function (paraText) {
				paraText = paraText.replace("%appname%", App.NAME);
				descriptionElems.push({text: paraText});
			});

			var tplData = {
				headerText: chrome.i18n.getMessage("tourStep" + num + "Title"),
				descriptionElems: descriptionElems,
				tourText: (num === STEPSNUM) ? chrome.i18n.getMessage("tourAgainButtonTitle") : chrome.i18n.getMessage("tourFurtherButtonTitle"),
				grantAccess: chrome.i18n.getMessage("installGrantAccess"),
				nextStep: (num === STEPSNUM) ? 1 : (num + 1)
			};

			tplData["step" + num] = true;
			var contents = Templates.render("tourStep", tplData);

			document.body.empty().html(contents);
			chrome.extension.sendMessage({"action" : "tourWatch", "step" : num});

			$("section.buttons.in-tour button.tour").bind("click", function (e) {
				var step = parseInt(this.data("step"), 10);
				self.view("tourStep", {}, [step]);

				e.stopPropagation();
			});

			$("section.buttons.in-tour button.access").bind("click", function (e) {
				chrome.extension.sendMessage({
					"action" : "getOAuthToken",
					"type" : "new"
				});

				e.stopPropagation();
			});
		},

		// просмотр данных о контакте
		showContact: function (uid, dontOpenUniqueThread) {
			var left = $("#content > section.left").empty().addClass("loading");
			var right = $("#content > section.right").empty().addClass("loading");
			var writeMessageIcon = $("#content > header > span.icon.write");
			var self = this;

			writeMessageIcon.bind("click", function() {
				self.view("writeMessageToContact", {
					uiType: "partial",
					headers: {
						right: [
							{"type" : "text", "name" : chrome.i18n.getMessage("newMessage")}
						]
					}
				}, [uid]);
			});

			// слева показываем подробную информацию о контакте
			chrome.extension.sendMessage({
				action: "getContactData",
				uid: uid,
				includeOnlineStatus: true
			}, function (userData) {
				if (!userData)
					return;

				left.removeClass().addClass("left", "contact-data");

				var leftHeaderText = $("#content > header.left > span.text");
				if (leftHeaderText.text() === "...")
					leftHeaderText.text(userData.first_name + " " + userData.last_name);

				try {
					userData.other_data = JSON.parse(userData.other_data);
				} catch (e) {
					userData.other_data = {
						domain: "id" + uid
					};
				}

				// avatar
				var avatarSrc = "pic/question_th.gif";
				if (self.CacheManager.avatars[uid] !== undefined) {
					if (self.CacheManager.avatars[uid].length) {
						avatarSrc = self.CacheManager.avatars[uid];
					}
				} else {
					chrome.extension.sendMessage({"action" : "loadAvatar", "uid" : uid});
				}

				var linkTitle = (/^id[0-9]+$/.test(userData.other_data.domain))
					? "vk.com/" + userData.other_data.domain
					: "@" + userData.other_data.domain;

				// birthday
				var hasBirthday = false;
				var birthday = "";
				if (userData.other_data.bdate && userData.other_data.bdate.length) {
					hasBirthday = true;

					var monthes = chrome.i18n.getMessage("monthes").split("|");
					var splitUserData = userData.other_data.bdate.split(".");
					var isEnglishLocale = (chrome.i18n.getMessage('@@ui_locale').indexOf('en') !== -1);
					var part;

					for (var i = 0; i < splitUserData.length; i++) {
						if (i === 1) {
							part = parseInt(splitUserData[i], 10) - 1;
							if (isEnglishLocale) {
								birthday += " " + Utils.string.ucfirst(monthes[part]);
							} else {
								birthday += " " + monthes[part];
							}
						} else {
							birthday += " " + splitUserData[i];
						}
					}
				}

				// home phone
				var hasHomePhone = false;
				var homePhone;
				if (userData.other_data.home_phone && userData.other_data.home_phone.length) {
					hasHomePhone = true;
					homePhone = userData.other_data.home_phone;
				}

				// mobile phone
				var hasMobilePhone = false;
				var mobilePhone;
				if (userData.other_data.mobile_phone && userData.other_data.mobile_phone.length) {
					hasMobilePhone = true;
					mobilePhone = userData.other_data.mobile_phone;
				}

				var contents = Templates.render("contactInfo", {
					avatarSrc: avatarSrc,
					uid: uid,
					linkToProfile: "http://vk.com/" + userData.other_data.domain,
					linkTitle: linkTitle,
					hasBirthday: hasBirthday,
					birthdayI18n: Utils.string.ucfirst(chrome.i18n.getMessage("birthdate")),
					birthday: birthday,
					hasMobilePhone: hasMobilePhone,
					mobilePhoneI18n: Utils.string.ucfirst(chrome.i18n.getMessage("mobilephone")),
					mobilePhone: mobilePhone,
					hasHomePhone: hasHomePhone,
					homePhoneI18n: Utils.string.ucfirst(chrome.i18n.getMessage("homephone")),
					homePhone: homePhone
				});

				left.append(contents);
			});

			// справа показываем диалоги, в которых участвует контакт и активный пользователь
			chrome.extension.sendMessage({
				action: "getConversationThreadsWithContact",
				uid: uid
			}, function (threads) {
				// отрисовываем список тредов
				var dialogSections = self._drawThreads(threads);
				right.removeClass().addClass("right", "dialogs-container").removeData().append(dialogSections);

				// если тред один, то сразу открываем его
				var threadsInserted = $$(right, "section[data-id]");

				if (threadsInserted.length === 1 && dontOpenUniqueThread !== true) {
					threadsInserted[0].click();
				}
			});
		},

		// поиск контактов
		searchContact: function () {
			var self = this;
			var leftSection = $("#content > section.left").empty().removeClass().addClass("left", "search-contacts-container", "contacts-container");
			var backIcon = $("#content > header.left > span.icon.back");

			var placeholderText = chrome.i18n.getMessage("searchContactPlaceholder");
			var formContents = Templates.render("searchForm", {placeholder: placeholderText});

			leftSection.append(formContents);
			var form = $(leftSection, "form");
			var searchInput = $(leftSection, "input[type='search']");

			/**
			 * Нахождение уникальных терминов в поисковой строке (например ["иванов"] из "иван иванов")
			 * @return {Array}
			 */
			var getUniqueSearchTermsFn = function (searchString) {
				var output = [];
				var terms = searchString.split(" ");
				var term, isSubstring;

				for (var i = 0; i < terms.length; i++) {
					isSubstring = false;

					for (var j = 0; j < terms.length; j++) {
						if (i === j)
							continue;

						if (terms[j].indexOf(terms[i]) !== -1) {
							isSubstring = true;
							break;
						}
					}

					if (!isSubstring) {
						output.push(terms[i]);
					}
				}

				return output;
			};

			var backendCallback = function (data) {
				var foundContacts = data[0];
				var total = data[1];
				var search = data[2];
				var contacts = [];
				var moreSection = $(leftSection, "section.more");
				var searchTerms;

				if (search !== searchInput.val())
					return;

				if (moreSection)
					moreSection.remove();

				searchTerms = getUniqueSearchTermsFn(search);
				foundContacts.forEach(function (userData) {
					var contactObj = self._prepareContactSection(userData, searchTerms);
					contacts.push(contactObj);
				});

				var contactsContents = Templates.render("contactsList", {contacts: contacts});
				leftSection.removeClass("loading").append(contactsContents);

				// добавляем при необходимости кнопку "еще"
				var totalShown = $$(leftSection, "section[data-uid]:not(.more)").length;
				if (totalShown < total) {
					var moreText = Utils.string.ucfirst(chrome.i18n.getMessage("more"));
					var more = $("<section class='more view'>" + moreText + "</section>").bind("click", function () {
						if (this.hasClass("loading"))
							return;

						this.html("&nbsp;").addClass("loading");
						chrome.extension.sendMessage({"action" : "searchContact", "value" : searchInput.val(), "totalShown" : totalShown}, backendCallback);
					});

					leftSection.append(more);
				}
			};

			// при первом вызове привязываем обработчик события onscroll
			leftSection.bind("scroll", function () {
				var moreSection = $(this, "section.more");
				if (!moreSection)
					return;

				var goPos = this.scrollHeight - 160;
				if (this.scrollTop + this.clientHeight > goPos) {
					moreSection.click();
				}
			});

			backIcon.bind("click", function () {
				form.remove();

				self.view("contactsList", {
					uiType: "partial",
					headers: {
						left: [
							{"type" : "text", "name" : chrome.i18n.getMessage("contactsName")},
							{"type" : "icon", "name" : "search", "title" : chrome.i18n.getMessage("searchContact")}
						]
					}
				});
			});

			searchInput.bind("search", function() {
				var more = $(leftSection, "section.more");
				if (more)
					more.remove();

				var allSections = $$(leftSection, "section[data-uid]");
				for (var section in allSections)
					section.remove();

				leftSection.removeClass("loading");
			});

			searchInput.bind("keyup", function() {
				var value = searchInput.val();
				var more = $(leftSection, "section.more");

				if (more)
					more.remove();

				if (!value.length) {
					$$(leftSection, "section[data-uid]").remove();
					return leftSection.removeClass("loading");
				}

				$$(leftSection, "section[data-uid]").remove();

				leftSection.addClass("loading");
				chrome.extension.sendMessage({
					action: "searchContact",
					value: searchInput.val(),
					totalShown: 0
				}, backendCallback);
			});

			searchInput.focus();
		},

		// показ "почтовых тредов" в правой половине окна
		mailList: function (startFrom) {
			startFrom = startFrom || 0;
			var rightSection = $("#content > section.right").addClass("loading"),
				listHeader = $("#content > header.right > span.icon.list"),
				searchHeader = $("#content > header.right > span.icon.search"),
				self = this;

			// при первом вызове привязываем обработчик события onscroll
			if (startFrom === 0) {
				rightSection.empty();

				rightSection.bind("scroll", function () {
					var moreSection = $(this, "section.more");
					if (!moreSection)
						return;
					
					var goPos = this.scrollHeight - 160;
					if (this.scrollTop + this.clientHeight > goPos) {
						moreSection.click();
					}
				}, true);

				listHeader.bind("click", function() {
					self.view("manageMail", {
						"uiType" : "partial",
						"headers" : {
							"left" : [
								{"type" : "text", "name" : chrome.i18n.getMessage("foldersAndTags")}
							]
						}
					});
				});

				searchHeader.bind("click", function() {
					self.view("searchMail", {
						"uiType" : "partial",
						"headers" : {
							"right" : [
								{"type" : "text", "name" : chrome.i18n.getMessage("searchMail")},
								{"type" : "icon", "name" : "back", "title" : chrome.i18n.getMessage("correspondence")}
							]
						}
					});
				});
			}

			chrome.extension.sendMessage({
				action: "fetchConversations",
				totalShown: startFrom
			}, function (dialogsData) {
				var dialogs = dialogsData[0];
				var total = dialogsData[1];
				var dialogSections = self._drawThreads(dialogs);
				var moreSection = $(rightSection, "section.more");

				rightSection.removeData().removeClass().addClass("right", "dialogs-container");
				if (moreSection)
					moreSection.remove();

				rightSection.append(dialogSections);

				// добавляем при необходимости кнопку "еще"
				var totalShown = $$(rightSection, "section[data-id]").length;
				if (totalShown < total) {
					var more = $("<section>").addClass("more", "view").text(Utils.string.ucfirst(chrome.i18n.getMessage("more"))).bind("click", function() {
						if (this.hasClass("loading"))
							return;

						this.html("&nbsp;").addClass("loading");
						self.view("mailList", {}, [totalShown]);
					});

					rightSection.append(more);
				}
			});
		},

		// настройки
		settings: function () {
			var self = this;
			var leftSection = $("#content > section.left").empty().removeClass().addClass("left", "accounts-list").removeData();
			var rightSection = $("#content > section.right").empty().removeClass().addClass("right", "settings-container").removeData();
			var addAccountIcon = $("#content > header > span.icon.plus");

			// добавление аккаунта
			addAccountIcon.bind("click", function () {
				$$(leftSection, "section.result").remove();
				chrome.extension.sendMessage({
					action: "getOAuthToken",
					type: "add"
				});
			});

			var optionsData = {
				saveBtnText: chrome.i18n.getMessage("saveBtn"),
				keysets: []
			};

			// сортировка контактов
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsSortContacts") + "&hellip;",
				name: "SortContacts",
				radio: true,
				items: [
					{value: 0, active: (self.SettingsManager.SortContacts === 0), title: chrome.i18n.getMessage("settingsSortContactsLast")},
					{value: 1, active: (self.SettingsManager.SortContacts === 1), title: chrome.i18n.getMessage("settingsSortContactsPopular")},
					{value: 2, active: (self.SettingsManager.SortContacts === 2), title: chrome.i18n.getMessage("settingsSortContactsAlpha")}
				]
			});

			// удаление контактов
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsDeleteUser") + "&hellip;",
				name: "DeleteUser",
				radio: true,
				items: [
					{value: 0, active: (self.SettingsManager.DeleteUser === 0), title: chrome.i18n.getMessage("settingsDeleteUserLocal")},
					{value: 1, active: (self.SettingsManager.DeleteUser === 1), title: chrome.i18n.getMessage("settingsDeleteUserServer")},
					{value: 2, active: (self.SettingsManager.DeleteUser === 2), title: chrome.i18n.getMessage("settingsDeleteUserEverything")}
				]
			});

			// громкость звука уведомлений
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsSoundLevel"),
				name: "SoundLevel",
				range: true,
				value: self.SettingsManager.SoundLevel * 10,
				min: 0,
				max: 10,
				step: 1
			});

			// время показа уедомлений
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsNotificationsTime"),
				name: "NotificationsTime",
				range: true,
				info: true,
				value: self.SettingsManager.NotificationsTime,
				min: 0,
				max: 12,
				step: 1
			});

			// показывать уведомления при открытой вкладке ВК
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsShowWhenVK"),
				name: "ShowWhenVK",
				radio: true,
				items: [
					{value: 0, active: (self.SettingsManager.ShowWhenVK === 0), title: chrome.i18n.getMessage("no")},
					{value: 1, active: (self.SettingsManager.ShowWhenVK === 1), title: chrome.i18n.getMessage("yes")}
				]
			});

			// показывать уведомления о ДР друзей
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsShowBirthdayNotifications"),
				name: "ShowBirthdayNotifications",
				radio: true,
				items: [
					{value: 0, active: (self.SettingsManager.ShowBirthdayNotifications === 0), title: chrome.i18n.getMessage("no")},
					{value: 1, active: (self.SettingsManager.ShowBirthdayNotifications === 1), title: chrome.i18n.getMessage("yes")}
				]
			});

			// добавлять геометки в отправляемые сообщения
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsAttachGeolocation"),
				name: "AttachGeolocation",
				radio: true,
				items: [
					{value: 0, active: (self.SettingsManager.AttachGeolocation === 0), title: chrome.i18n.getMessage("no")},
					{value: 1, active: (self.SettingsManager.AttachGeolocation === 1), title: chrome.i18n.getMessage("yes")}
				]
			});

			// онлайн-статус контактов
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsShowOnline"),
				name: "ShowOnline",
				radio: true,
				items: [
					{value: 0, active: (self.SettingsManager.ShowOnline === 0), title: chrome.i18n.getMessage("no")},
					{value: 1, active: (self.SettingsManager.ShowOnline === 1), title: chrome.i18n.getMessage("yes")}
				]
			});

			// debug level
			optionsData.keysets.push({
				header: chrome.i18n.getMessage("settingsDebug"),
				name: "Debug",
				radio: true,
				items: [
					{value: 0, active: (self.SettingsManager.Debug === 0), title: chrome.i18n.getMessage("settingsDebugWarningsErrors")},
					{value: 1, active: (self.SettingsManager.Debug === 1), title: chrome.i18n.getMessage("settingsDebugMore")},
					{value: 2, active: (self.SettingsManager.Debug === 2), title: chrome.i18n.getMessage("settingsDebugEverything")}
				]
			});

			var optionsHTML = Templates.render("settingsOptions", optionsData);
			rightSection.html(optionsHTML);

			$(rightSection, "input[name='SoundLevel']").bind("change", function () {
				self.SoundManager.play("message", this.val() / 10);
			});

			var notificationsTimeElem = $(rightSection, "output.range-info");
			var notificationsRange = $(rightSection, "input[name='NotificationsTime']");
			notificationsRange.bind("change", function () {
				var value = parseInt(this.val(), 10);
				switch (value) {
					case 0 :
						notificationsTimeElem.text(chrome.i18n.getMessage('notificationsHide'));
						break;
					
					case 12 :
						notificationsTimeElem.text(chrome.i18n.getMessage('notificationsShow'));
						break;
					
					default :
						notificationsTimeElem.text(value * 5 + ' ' + chrome.i18n.getMessage('second'));
				}
			});

			// вручную генерируем "change"-событие для показа output.range-info
			var evt = document.createEvent("HTMLEvents");
			evt.initEvent("change", false, true);
			notificationsRange.dispatchEvent(evt);

			// заполняем список аккаунтов
			var usersTplData = [];
			var userData, chunkData;
			var avatarSrc, switchAccountText;

			for (var uid in self.AccountsManager.list) {
				userData = self.AccountsManager.list[uid];

				// подготовка аватарки
				avatarSrc = "pic/question_th.gif";
				if (self.CacheManager.avatars[uid] !== undefined) {
					if (self.CacheManager.avatars[uid].length) {
						avatarSrc = self.CacheManager.avatars[uid];
					}
				} else {
					chrome.extension.sendMessage({"action" : "loadAvatar", "uid" : uid});
				}

				switchAccountText = (uid == self.AccountsManager.currentUserId)
					? chrome.i18n.getMessage("currentActiveAccount")
					: chrome.i18n.getMessage("switchToAnotherAccount");

				chunkData = {
					id: uid,
					avatarSrc: avatarSrc,
					deleteAccountText: chrome.i18n.getMessage("deleteAccount"),
					updateTokenText: chrome.i18n.getMessage("updateAccountToken"),
					switchAccountText: switchAccountText,
					active: (uid == self.AccountsManager.currentUserId),
					fio: userData.fio
				};

				usersTplData.push(chunkData);
			}

			var accountsHTML = Templates.render("settingsAccounts", {users: usersTplData});
			leftSection.html(accountsHTML);

			$$(leftSection, "span.switch").bind("click", function () {
				if (this.hasClass("active"))
					return;

				var uid = this.closestParent("section[data-uid]").data("uid");
				chrome.extension.sendMessage({"action" : "switchToAccount", "uid" : uid});
			});

			$$(leftSection, "span.update").bind("click", function () {
				$$(leftSection, "section.result").remove();

				var uid = this.closestParent("section[data-uid]").data("uid");
				chrome.extension.sendMessage({
					action: "getOAuthToken",
					type: "update",
					uid: uid
				});
			});

			$$(leftSection, "span.delete").bind("click", function () {
				var accountSection = this.closestParent("section[data-uid]");
				var uid = accountSection.data("uid");
				var nextAccountSection, nextAccountUid;

				if (accountSection.nextElementSibling) {
					nextAccountUid = accountSection.nextElementSibling.data("uid");
				} else {
					nextAccountUid = (accountSection.previousElementSibling)
						? accountSection.previousElementSibling.data("uid")
						: false;
				}

				$$(leftSection, "section.result").remove();
				chrome.extension.sendMessage({
					action: "deleteAccount",
					uid: uid,
					next: nextAccountUid
				});
			});
		},

		// новости по каналу
		news: function () {
			var self = this;
			var oneSection = $("#content > section.one").removeClass().addClass("one", "news-container").removeData().empty();
			var newsIcon = $("aside > span.news").removeData().removeAttr("title").addClass("is-empty").empty();
			var tipsyLayer = $("div.tipsy");

			var storedPostsArray = StorageManager.get("vkgroupwall_stored_posts", {constructor: Array, strict: true, create: true});
			var seenPostsArray = StorageManager.get("vkgroupwall_synced_posts", {constructor: Array, strict: true, create: true});

			// избавляемся от артефактов tipsy
			if (tipsyLayer)
				tipsyLayer.remove();

			if (!storedPostsArray.length) {
				StorageManager.remove("vkgroupwall_stored_posts");
				$("#header > section.acc-container").click();

				return;
			}

			// отрисовка новостей
			var newsData = [];
			var monthesi18nTerm = chrome.i18n.getMessage('monthesCut').split('|');

			storedPostsArray.forEach(function (postData) {
				var postDate = new Date(postData.date * 1000);

				var tplItem = {
					date: postDate.getDate() + " " + monthesi18nTerm[postDate.getMonth()] + " " + postDate.getFullYear(),
					id: postData.id,
					text: postData.text,
					attachments: []
				};

				(postData.attachments || []).forEach(function (attachmentData) {
					var data = attachmentData[attachmentData.type];
					var id;

					switch (attachmentData.type) {
						case "photo" : // фотография из альбома
						case "posted_photo" : // фотография, загруженная напрямую с компьютера пользователя
							var imgAspect = data.width / data.height;
							var imgWidth = Math.min(data.width, oneSection.offsetWidth);
							var imgHeight = Math.round(imgWidth / imgAspect);

							tplItem.attachments.push({
								photo: true,
								width: imgWidth,
								height: imgHeight,
								src: Utils.misc.searchBiggestImage(data)
							});

							break;
							
						case "video" : // видеозапись
							id = "vid_" + data.owner_id + data.vid;

							tplItem.attachments.push({
								video: true,
								id: id
							});

							chrome.extension.sendMessage({
								action: "getVideoById",
								ownerId: data.owner_id,
								id: data.vid
							}, function (videoInfo) {
								if (!videoInfo)
									return;

								var attachmentArea = $("#" + id).removeClass("hidden");
								var descriptionText = (videoInfo.description.indexOf(videoInfo.title) === -1) ? videoInfo.title + "<br>" + videoInfo.description : videoInfo.description;

								$(attachmentArea, "iframe").attr("src", videoInfo.player);
								$(attachmentArea, "span.description").html(Utils.string.replaceLinks(descriptionText.replace(/(<br>){2,}/gm, "<br>")));
							});

							break;
							
						case "audio": // аудиозапись
							id = "aud_" + data.owner_id + data.aid;

							tplItem.attachments.push({
								audio: true,
								id: id
							});

							chrome.extension.sendMessage({
								action: "getAudioById",
								ownerId: data.owner_id,
								id: data.aid
							}, function (audioInfo) {
								if (!audioInfo)
									return;

								var attachmentArea = $("#" + id).removeClass("hidden");

								$(attachmentArea, "span.description").text(audioInfo.artist + " - " + audioInfo.title);
								$(attachmentArea, "audio").attr("src", audioInfo.url).bind("playing", function () {
									chrome.extension.sendMessage({
										action: "newsAudioPlaying",
										id: postData.id,
										owner_id: data.owner_id,
										aid: data.aid
									});
								});
							});

							break;

						case "link": // ссылка на web-страницу
							tplItem.attachments.push({
								link: true,
								url: data.url,
								title: data.title,
								description: Utils.string.replaceLinks(data.description)
							});

							break;
							
						case "doc" : // документ
							id = "doc_" + data.owner_id + data.did;

							var tplData = {
								doc: true,
								id: id,
								nolink: (data.url === undefined)
							};

							if (data.url) {
								tplData.url = data.url;
								tplData.fileName = (regex.test(data.title)) ? data.title : data.title + "." + data.ext;
								tplData.title = data.title;
								tplData.description = Utils.string.humanFileSize(data.size) + ", " + chrome.i18n.getMessage("fileType") + ": " + data.ext.toUpperCase();
							} else {
								chrome.extension.sendMessage({
									action: "getDocById",
									ownerId: data.owner_id,
									id: data.did
								}, function (fileInfo) {
									if (!fileInfo)
										return;

									var regex = new RegExp(fileInfo.ext + "$");
									var attachmentArea = $("#" + id).removeClass("hidden");
									var fileName = (regex.test(fileInfo.title)) ? fileInfo.title : fileInfo.title + "." + fileInfo.ext;

									$(attachmentArea, "a").attr({
										href: fileInfo.url,
										download: fileName
									}).text(data.title);

									var descriptionText = Utils.string.humanFileSize(fileInfo.size) + ", " + chrome.i18n.getMessage("fileType") + ": " + fileInfo.ext.toUpperCase();
									$(attachmentArea, "span.description").text(descriptionText);
								});
							}

							tplItem.attachments.push(tplData);
							break;
							
						default :
							chrome.extension.sendMessage({
								action: "errorGot",
								error: "Unsupported attachment type",
								message: [attachmentData.type, postData.id]
							});
					}
				});

				newsData.push(tplItem);

				seenPostsArray.push(postData.id);
				chrome.extension.sendMessage({"action" : "newsPostSeen", "id" : postData.id});
			});

			var newsHTML = Templates.render("news", {news: newsData});
			oneSection.html(newsHTML);

			$(oneSection, "a").bind("click", function () {
				var id = this.closestParent("section[data-id]").data("id");

				chrome.extension.sendMessage({
					action: "newsLinkClicked",
					id: id,
					url: this.attr("href")
				});
			});

			// добавляем ID постов в список просмотренных
			StorageManager.set("vkgroupwall_synced_posts", seenPostsArray);

			// очищаем сохраненные данные
			StorageManager.remove("vkgroupwall_stored_posts");
		},

		// чаты-диалоги
		chat: function (dialogId, startFrom) {
			var right = $("#content > section.right");
			var rightHeader = $("#content > header.right");
			var rightHeaderText = $(rightHeader, "span.text").text();
			var rightHeaderBack = $(rightHeader, "span.icon.back");
			var rightHeaderPrint = $(rightHeader, "span.icon.print");
			var rightHeaderSearch = $(rightHeader, "span.icon.search");
			var self = this;

			startFrom = startFrom || 0;
			if (startFrom === 0) {
				// при первом вызове привязываем обработчик события onscroll
				right.bind("scroll", function (e) {
					var moreSection = $(this, "section.more");
					if (!moreSection)
						return;

					if (this.scrollTop <= 160) {
						moreSection.click();
					}
				}, true);

				rightHeaderPrint.bind("click", function() {
					chrome.tabs.create({
						"url" : App.resolveURL("print.html?did=" + dialogId)
					});
				});

				rightHeaderSearch.bind("click", function() {
					self.view("searchMail", {
						"uiType" : "partial",
						"headers" : {
							"right" : [
								{"type" : "text", "name" : chrome.i18n.getMessage("searchMail")},
								{"type" : "icon", "name" : "back", "title" : chrome.i18n.getMessage("correspondence")}
							]
						}
					}, [{"id" : dialogId, "chatName" : rightHeaderText}]);
				});

				if (this.prevShownView[0] === "showContact") {
					var uid = this.prevShownView[1];

					$("#content > header.right > span.icon.back").bind("click", function(e) {
						self.view("showContact", {
							"uiType" : "partial",
							"headers" : {
								"left" : [
									{"type" : "text", "name" : "..."},
									{"type" : "icon", "name" : "write", "title" : chrome.i18n.getMessage("writeMessage")}
								],
								"right" : [
									{"type" : "text", "name" : chrome.i18n.getMessage("correspondence")}
								]
							}
						}, [uid, true]);
					});
				} else {
					$("#content > header.right > span.icon.back").bind("click", function(e) {
						self.view("mailList", {
							"uiType" : "partial",
							"headers" : {
								"right" : [
									{"type" : "text", "name" : chrome.i18n.getMessage("correspondence")},
									{"type" : "icon", "name" : "list", "title" : chrome.i18n.getMessage("correspondenceManagement")},
									/*{"type" : "icon", "name" : "write", "title" : chrome.i18n.getMessage("writeMessage")},*/
									{"type" : "icon", "name" : "search", "title" : chrome.i18n.getMessage("searchMail")}
								]
							}
						});
					});
				}

				// очищаем правую часть окна
				right.empty().addClass("loading").data("dialogId", dialogId);
			}

			chrome.extension.sendMessage({
				action: "getDialogThread",
				id: dialogId,
				from: startFrom
			}, function (dialogData) {
				var messages = dialogData[0],
					total = dialogData[1],
					msgSection,
					insertSections = [],
					avatar, totalShown, scrollToElem,
					startIndex = messages.length - 1,
					createNewSpeechSection = true,
					lastUserSpeechSection, lastSpeechUid, lastSpeechTs,
					msgSenderUid, isInboxMsg;

				var dialogIdTmp = right.data("dialogId");
				right.removeClass().removeData().data("dialogId", dialogIdTmp).addClass("right", "chat-container");

				var moreSection = $(right, "section.more");
				if (moreSection)
					moreSection.remove();

				var scrollToElem;
				if (startFrom)
					scrollToElem = $(right, "section.msg");

				for (var i = startIndex; i >= 0; i--) {
					isInboxMsg = (messages[i].tags & self.CacheManager.tags.inbox);
					msgSenderUid = (isInboxMsg) ? messages[i].uid : self.AccountsManager.currentUserId;
					msgSection = self._prepareMessage(messages[i]);

					if (i === startIndex) {
						lastUserSpeechSection = $(right, "section.user-speech:first-of-type");
						if (lastUserSpeechSection) {
							lastSpeechUid = parseInt(lastUserSpeechSection.data("uid"), 10);
							lastSpeechTs = parseInt(lastUserSpeechSection.data("ts"), 10);

							createNewSpeechSection = (msgSenderUid !== lastSpeechUid);
						} else {
							lastSpeechUid = msgSenderUid;
							lastSpeechTs = messages[i].date;
						}
					} else {
						createNewSpeechSection = (msgSenderUid !== lastSpeechUid);
						if (createNewSpeechSection) {
							lastSpeechUid = msgSenderUid;
						} else if (lastSpeechTs - messages[i].date > 8*60*60) { // 8 часов
							createNewSpeechSection = true;
						}

						lastSpeechTs = messages[i].date;
					}

					// если это новый монолог, создаем его обертку
					if (createNewSpeechSection) {
						lastUserSpeechSection = self._drawUserSpeechSection(messages[i]);
						insertSections.unshift(lastUserSpeechSection);
					}

					// добавляем новое сообщение после аватарки
					$(lastUserSpeechSection, "img").after(Templates.render("chatMessage", msgSection));
				}

				if (insertSections.length)
					right.prepend(insertSections);

				$$(right, "section.msg").bind("mouseover", self._chatMessageMouseOverListener);

				// определять scrollTop для элемента после вставки других
				if (startFrom === 0) {
					var replyAreaForm = self._drawMessageSendForm("simple");
					right.append(replyAreaForm);

					replyAreaForm.scrollIntoView();
				} else {
					scrollToElem.scrollIntoView(true);
				}

				var totalShown = $$(right, "section.msg").length;
				if (totalShown < total) {
					var more = $("<section>").addClass("more", "view").text(Utils.string.ucfirst(chrome.i18n.getMessage("more"))).bind("click", function() {
						if (this.hasClass("loading"))
							return;

						// может измениться за время просмотра чата
						var totalShown = $$(right, "section.msg").length;

						this.html("&nbsp;").addClass("loading");
						self.view("chat", {}, [dialogId, totalShown]);
					});

					right.prepend(more);
				}
			});
		},

		// список папок
		manageMail: function () {
			var self = this;
			var leftSection = $("#content > section.left").removeClass().addClass("left", "manage-mail", "loading").removeData().empty();
			var rightSection = $("#content > section.right").removeClass().addClass("right").removeData().empty();
			var searchRightHeader = $("#content > header.right > span.icon.search");
			var folders = [];

			// добавляем стартовые метки-папки
			App.INIT_TAGS.forEach(function (tagName) {
				if (tagName === "important" || tagName === "attachments" || tagName === "trash")
					return;

				if (tagName === "outbox" || tagName === "drafts")
					return;

				folders.push({
					tid: self.CacheManager.tags[tagName],
					title: chrome.i18n.getMessage("tag" + Utils.string.ucfirst(tagName) + "Name"),
					total: 0
				});
			});

			// добавляем "удаленные", "важные" и "с вложениями"
			["trash", "important", "attachments"].forEach(function (tagName) {
				folders.push({
					tid: self.CacheManager.tags[tagName],
					title: chrome.i18n.getMessage("tag" + Utils.string.ucfirst(tagName) + "Name"),
					classNames: "custom " + tagName,
					total: 0
				});
			});

			// добавляем кастомные тэги
			for (var tagName in self.CacheManager.tags) {
				if (App.INIT_TAGS.indexOf(tagName) !== -1)
					continue;

				folders.push({
					tid: self.CacheManager.tags[tagName],
					title: tagName,
					total: 0
				});
			}

			chrome.extension.sendMessage({action: "getTagsFrequency"}, function (freq) {
				folders.forEach(function (folder) {
					folder.total = freq[folder.tid] || 0;
				});

				var foldersHTML = Templates.render("mailFolders", {folders: folders});
				leftSection.html(foldersHTML);
				$(leftSection, "li[data-tid]").click();
			});
		},

		// список сообщений определенной папки
		messagesOfType: function (tagId, startFrom) {
			var self = this;
			var textHeader = $("#content > header.right > span.text");
			var listHeader = $("#content > header.right > span.icon.list");
			var searchHeader = $("#content > header.right > span.icon.search");
			var rightSection = $("#content > section.right").data("tagId", tagId);

			var isCustomTag = true;
			var tagTitle;

			startFrom = startFrom || 0;

			// при первом вызове привязываем обработчик события onscroll
			if (startFrom === 0) {
				rightSection.empty().addClass("loading");

				// устанавливаем span.text
				for (i = 0; i < App.INIT_TAGS.length; i++) {
					if (self.CacheManager.tags[App.INIT_TAGS[i]] === tagId) {
						isCustomTag = false;
						tagTitle = chrome.i18n.getMessage("tag" + Utils.string.ucfirst(App.INIT_TAGS[i]) + "Name");
						break;
					}
				}

				if (isCustomTag) {
					for (var customTagTitle in self.CacheManager.tags) {
						if (self.CacheManager.tags[customTagTitle] === tagId) {
							tagTitle = customTagTitle;
							break;
						}
					}
				}

				textHeader.text(tagTitle);

				listHeader.bind("click", function () {
					self.view("manageMail", {
						uiType: "partial",
						headers: {
							left: [
								{"type" : "text", "name" : chrome.i18n.getMessage("foldersAndTags")}
							]
						}
					});
				});

				searchHeader.bind("click", function () {
					self.view("searchMail", {
						uiType: "partial",
						headers: {
							right: [
								{"type" : "text", "name" : chrome.i18n.getMessage("searchMail")},
								{"type" : "icon", "name" : "back", "title" : chrome.i18n.getMessage("correspondence")}
							]
						}
					}, [{tag: tagId}]);
				});

				rightSection.bind("scroll", function () {
					var moreSection = $(this, "section.more");
					if (!moreSection)
						return;
					
					var goPos = this.scrollHeight - 160;
					if (this.scrollTop + this.clientHeight > goPos) {
						moreSection.click();
					}
				}, true);

				if (tagId === self.CacheManager.tags.important) {
					chrome.extension.sendMessage({"action" : "useImportantTag", "type" : "list"});
				}
			}

			chrome.extension.sendMessage({
				action: "getMessagesByTagId",
				tagId: tagId,
				totalShown: startFrom
			}, function (data) {
				var messagesData = data[0];
				var total = data[1];
				var moreSection = $(rightSection, "section.more");

				if (moreSection)
					moreSection.remove();

				var halfSections = [];
				messagesData.forEach(function (msgData) {
					var tplData = self._prepareHalfSection(msgData);
					halfSections.push(tplData);
				});

				var sectionsHTML = Templates.render("halfSections", {sections: halfSections});
				var tagIdTmp = rightSection.data("tagId");
				rightSection.removeData().data("tagId", tagIdTmp).removeClass().addClass("right", "thread-container").append(sectionsHTML);

				// добавляем при необходимости кнопку "еще"
				var totalShown = $$(rightSection, "section[data-mid]").length + messagesData.length;
				if (totalShown < total) {
					var more = $("<section>").addClass("more").text(Utils.string.ucfirst(chrome.i18n.getMessage("more"))).bind("click", function () {
						if (this.hasClass("loading"))
							return;

						this.html("&nbsp;").addClass("loading");
						self.view("messagesOfType", {}, [tagId, totalShown]);
					});

					rightSection.append(more);
				}
			});
		},

		/**
		 * Поиск писем
		 * @param {Object} params (необяз.) с ключами id (поиск в треде) или tag (поиск в определенном типе писем)
		 */
		searchMail: function (params) {
			var self = this;
			var rightSection = $("#content > section.right").empty().removeClass().addClass("right", "search-mail-container", "thread-container");
			var backIcon = $("#content > header.right > span.icon.back");

			var placeholderText = chrome.i18n.getMessage("searchMailPlaceholder");
			var formContents = Templates.render("searchForm", {placeholder: placeholderText});

			rightSection.append(formContents);
			var form = $(rightSection, "form");
			var searchInput = $(rightSection, "input[type='search']");

			params = params || {};

			// хак из чатов, поскольку иначе очень проблематично передавать название чата
			var chatName = params.chatName;
			delete params.chatName;

			var backendCallback = function (data) {
				var foundMessages = data[0],
					total = data[1],
					search = data[2],
					mailSections = [],
					moreSection = $(rightSection, "section.more"),
					totalShown, more;

				if (search !== searchInput.val()) {
					return;
				}

				if (moreSection !== null) {
					moreSection.remove();
				}

				foundMessages.forEach(function(msgData) {
					var section = self._prepareHalfSection(msgData, search);
					mailSections.push(section);
				});

				var sectionsHTML = Templates.render("halfSections", {sections: mailSections});
				rightSection.removeClass("loading").append(sectionsHTML);

				// добавляем при необходимости кнопку "еще"
				totalShown = $$(rightSection, "section[data-mid]").length;
				if (totalShown < total) {
					more = $("<section>").addClass("more", "view").text(Utils.string.ucfirst(chrome.i18n.getMessage("more"))).bind("click", function() {
						if (this.hasClass("loading")) {
							return;
						}

						this.html("&nbsp;").addClass("loading");
						chrome.extension.sendMessage({"action" : "searchMail", "params" : params, "value" : searchInput.val(), "totalShown" : totalShown}, backendCallback);
					});

					rightSection.append(more);
				}
			};

			// при первом вызове привязываем обработчик события onscroll
			rightSection.bind("scroll", function () {
				var moreSection = $(this, "section.more");
				if (!moreSection)
					return;

				var goPos = this.scrollHeight - 160;
				if (this.scrollTop + this.clientHeight > goPos) {
					moreSection.click();
				}
			}, true);

			backIcon.bind("click", function() {
				form.remove();

				switch (self.prevShownView[0]) {
					case "chat" :
						self.view("chat", {
							"uiType" : "partial",
							"headers" : {
								"right" : [
									{"type" : "text", "name" : chatName},
									{"type" : "icon", "name" : "back", "title" : chrome.i18n.getMessage("backToDialogsList")},
									{"type" : "icon", "name" : "search", "title" : chrome.i18n.getMessage("searchMail")},
									{"type" : "icon", "name" : "print", "title" : chrome.i18n.getMessage("printCorrespondence")}
								]
							}
						}, [params.id]);

						break;

					case "messagesOfType" :
						self.view("messagesOfType", {
							"uiType" : "partial",
							"headers" : {
								"right" : [
									{"type" : "text", "name" : "..."},
									{"type" : "icon", "name" : "list", "title" : chrome.i18n.getMessage("correspondenceManagement")},
									{"type" : "icon", "name" : "search"}
								]
							}
						}, [params.tag]);

						break;

					default :
						self.view("mailList", {
							"uiType" : "partial",
							"headers" : {
								"right" : [
									{"type" : "text", "name" : chrome.i18n.getMessage("correspondence")},
									{"type" : "icon", "name" : "list", "title" : chrome.i18n.getMessage("correspondenceManagement")},
									/*{"type" : "icon", "name" : "write", "title" : chrome.i18n.getMessage("writeMessage")},*/
									{"type" : "icon", "name" : "search", "title" : chrome.i18n.getMessage("searchMail")}
								]
							}
						});
				}
			});

			searchInput.bind("search", function () {
				var more = $(rightSection, "section.more");
				if (more)
					more.remove();

				$$(rightSection.removeClass("loading"), "section[data-mid]").remove();
			});

			searchInput.bind("keyup", function () {
				var value = this.val();
				var moreSection = $(rightSection, "section.more");

				if (moreSection)
					moreSection.remove();

				if (!value.length)
					return $$(rightSection.removeClass("loading"), "section[data-mid]").remove();

				$$(rightSection.addClass("loading"), "section[data-mid]").remove();
				chrome.extension.sendMessage({
					action: "searchMail",
					params: params,
					value: this.val(),
					totalShown: 0
				}, backendCallback);
			});

			searchInput.focus();
		},

		writeMessageToContact: function (contactId) {
			var rightSection = $("#content > section.right").empty().addClass("thread-container").data("dialogId", "0_" + contactId);
			var replyAreaForm = this._drawMessageSendForm("face-to-face");

			rightSection.append(replyAreaForm);
		},

		shownViews: []
	},

	/**
	 * Базовый метод для отрисовки видов
	 *
	 * @param {String} viewName название метода объекта AppUI.Views
	 * @param {Object} requiredParams объект с ключами uiType и headers
	 * @param {Array} optionalParams массив аргументов, которые будут переданы в метод AppUI.Views.%viewName%
	 */
	view: function (viewName, requiredParams, optionalParams) {
		if (!this.Views[viewName])
			throw new Error("View #" + viewName + " doesn't exist");

		if (requiredParams.uiType !== undefined && ["partial", "full"].indexOf(requiredParams.uiType) === -1)
			throw new Error("No/wrong UI type was set when calling #" + viewName + " view");

		optionalParams = optionalParams || [];
		if (!(optionalParams instanceof Array))
			throw new TypeError("Optional params type for #" + viewName + " view is not array: " + typeof optionalParams);

		var content = $("#content");

		// очищаем ненужные секции данных
		if (requiredParams.uiType) {
			if (requiredParams.uiType === "partial") {
				$$(content, "section.one, header.one").addClass("is-empty").empty();
			} else {
				$$(content, "section.left, header.left, section.right, header.right").addClass("is-empty").empty();
			}
		}

		if (requiredParams.headers !== undefined) {
			// ключи каждого элемента массива: type (icon, text), name (icon -> class, text -> innerText), {String} view, {Array} params
			var sectionHeader;

			for (var prop in requiredParams.headers) {
				if (["left", "right", "one"].indexOf(prop) === -1)
					throw new Error("Section header for #" + viewName + " view is denied: " + prop);

				sectionHeader = $(content, "header." + prop).removeClass("is-empty").empty();
				requiredParams.headers[prop].forEach(function (item) {
					var elem = $("<span/>").addClass(item.type);

					if (item.type === "icon") {
						elem.addClass(item.name);
						if (item.title) {
							elem.attr("title", Utils.string.ucfirst(item.title)).data("gravity", "n");
						}
					} else {
						elem.text(item.name);
					}

					sectionHeader.append(elem);
				});
			}
		}

		this.Views.shownViews.push([viewName].concat(optionalParams));
		return this.Views[viewName].apply(this, optionalParams);
	},

	main: function (type, force) {
		if (force === undefined)
			force = false;

		if (this._currentMainType === type && !force)
			return;

		this._currentMainType = type;
		this._mainTypes[type].call(this);
	},

	_mainTypes: {
		brokenApp: function () {
			var contents = Templates.render("frontendAttention", {
				description: chrome.i18n.getMessage("chromeAppIsBroken"),
				btnText: chrome.i18n.getMessage("updateItNow")
			});

			document.body.removeClass().addClass("grey").html(contents);

			$("button.green").bind("click", function () {
				chrome.tabs.create({
					url: "https://www.google.com/chrome/"
				});
			});
		},

		backendLoading: function () {
			var contents = Templates.render("frontendAttention", {
				description: chrome.i18n.getMessage("backendIsLoading"),
				btnText: chrome.i18n.getMessage("refreshPage")
			});

			document.body.removeClass().addClass("grey").html(contents);

			$("button.green").bind("click", function () {
				window.location.reload();
			});
		},

		guest: function () {
			var firstInstallText = chrome.i18n.getMessage("firstInstallText").replace("%appname%", App.NAME);
			var firstInstallTextMatches = firstInstallText.match(/(.+)\|(.+)\|(.+)/);
			var self = this;

			var contents = Templates.render("guest", {
				afterBegin: firstInstallTextMatches[1],
				grantAccessLink: firstInstallTextMatches[2],
				beforeEnd: firstInstallTextMatches[3],
				takeTour: chrome.i18n.getMessage("takeTour"),
				grantAccessBtn: chrome.i18n.getMessage("installGrantAccess")
			});

			var authFn = function (e) {
				chrome.extension.sendMessage({
					action: "getOAuthToken",
					type: "new"
				});

				e.stopPropagation();
			};

			document.body.removeClass().addClass("grey").html(contents);

			$("button.tour").bind("click", function (e) {
				self.view("tourStep", {}, [1]);
				e.stopPropagation();
			});

			$("button.access").bind("click", authFn);
			$("p.description a").bind("click", authFn);
		},

		syncing: function() {
			var self = this;

			chrome.extension.sendMessage({
				action: "currentSyncValues"
			}, function (syncingData) {
				var avatarSrc = "pic/question_th.gif";
				if (self.CacheManager.avatars[self.AccountsManager.currentUserId] !== undefined) {
					if (self.CacheManager.avatars[self.AccountsManager.currentUserId].length) {
						avatarSrc = self.CacheManager.avatars[self.AccountsManager.currentUserId];
					}
				} else {
					chrome.extension.sendMessage({"action" : "loadAvatar", "uid" : self.AccountsManager.currentUserId});
				}

				var tplData = {
					avatarSrc: avatarSrc,
					uid: self.AccountsManager.currentUserId,
					fio: (self.AccountsManager.current.fio === "...") ? "#" + self.AccountsManager.currentUserId : self.AccountsManager.current.fio,
					data: []
				};

				for (var key in syncingData) {
					tplData.data.push({
						key: key,
						description: chrome.i18n.getMessage("syncing" + Utils.string.ucfirst(key)),
						percentSynced: (syncingData[key][0]) ? Math.ceil(syncingData[key][1] / syncingData[key][0] * 100) : 0,
						max: syncingData[key][0],
						current: syncingData[key][1]
					});
				}

				var contents = Templates.render("syncing", tplData);
				document.body.removeClass().addClass("grey").html(contents);
			});
		},

		user: function () {
			var self = this;
			var wallTokenUpdated = StorageManager.get("wall_token_updated", {constructor: Object, strict: true, create: true});
			var appLike = StorageManager.get("app_like", {constructor: Array, strict: true, create: true});
			var tokenUpdatedForUser = (wallTokenUpdated[this.AccountsManager.currentUserId] === 1);
			var appLikedByUser = (appLike.indexOf(this.AccountsManager.currentUserId) !== -1);

			var tplData = {
				multipleAccountsMargin: 3,
				accounts: [],
				activeAccountFio: (this.AccountsManager.current.fio === "...") ? "#" + this.AccountsManager.currentUserId : this.AccountsManager.current.fio,
				offline: !navigator.onLine,
				tokenExpired: this.CacheManager.isTokenExpired,
				settingsTitle: chrome.i18n.getMessage("options"),
				alertTitle: chrome.i18n.getMessage("alertIconTitle"),
				likeTitle: chrome.i18n.getMessage("likeIconTitle").replace("%appname%", App.NAME) + "!",
				showLike: (tokenUpdatedForUser && appLikedByUser === false)
			};

			var accountsNum = 0;
			var accountData, avatarSrc, methodToInsert;

			for (var uid in this.AccountsManager.list) {
				accountData = {
					avatarSrc: "pic/question_th.gif",
					uid: uid
				};

				if (this.CacheManager.avatars[uid] !== undefined) {
					if (this.CacheManager.avatars[uid].length) {
						accountData.avatarSrc = this.CacheManager.avatars[uid];
					}
				} else {
					chrome.extension.sendMessage({"action" : "loadAvatar", "uid" : uid});
				}

				// текущий пользователь должен быть последним в списке
				methodToInsert = (parseInt(uid, 10) === this.AccountsManager.currentUserId) ? "push" : "unshift";
				Array.prototype[methodToInsert].call(tplData.accounts, accountData);

				if (accountsNum)
					tplData.multipleAccountsMargin -= 56;

				accountsNum += 1;
			}

			tplData.multipleAccounts = (accountsNum > 1);

			document.body.removeClass().addClass("white");
			if (navigator.platform.indexOf("Win") !== -1)
				document.body.addClass("win");

			var html = Templates.render("main", tplData);
			document.body.html(html);


			// ставим простой таймаут, чтобы после смены аккаунта / перезагрузки страницы не прыгал блок с аватарками
			window.setTimeout(function() {
				$("section.acc-container").addClass("loaded");
			}, 1000);

			$("section.acc-container").bind("click", function(e) {
				var hasManyAccounts = ($$(this, "img[data-uid]").length > 1);
				var matchesSelectorFn = (this.webkitMatchesSelector || this.matchesSelector);
				var avatarClicked = matchesSelectorFn.call(e.target, "img[data-uid]");
				var uidClicked = avatarClicked ? parseInt(e.target.data("uid"), 10) : null;

				if (avatarClicked && hasManyAccounts && uidClicked !== self.AccountsManager.currentUserId) {
					chrome.extension.sendMessage({"action" : "switchToAccount", "uid" : e.target.data("uid")});
				} else {
					self.main("user", true);
				}
			});

			$("span.icon.github").bind("click", function() {
				chrome.tabs.create({
					url: "https://github.com/1999/vkoffline"
				});
			});

			$("span.icon.alert").bind("click", function() {
				self.view("errorSend", {
					uiType: "full",
					headers: {
						one: [
							{"type" : "text", "name" : chrome.i18n.getMessage("errorFormTitle")}
						]
					}
				});
			});

			$("span.icon.settings").bind("click", function() {
				self.view("settings", {
					uiType: "partial",
					headers: {
						left: [
							{"type" : "text", "name" : chrome.i18n.getMessage("accounts")},
							{"type" : "icon", "name" : "plus", "title" : chrome.i18n.getMessage("addMoreProfiles")}
						],
						right: [
							{"type" : "text", "name" : chrome.i18n.getMessage("options")}
						]
					}
				});
			});

			var likeIcon = $("span.icon.like");
			if (likeIcon) {
				likeIcon.bind("click", function() {
					var appLike = StorageManager.get("app_like", {constructor: Array, strict: true, create: true});
					var icon = this;

					chrome.extension.sendMessage({action: "addLike"}, function (likeResult) {
						switch (likeResult) {
							case 1 :
								appLike.push(self.AccountsManager.currentUserId);
								StorageManager.set("app_like", appLike);

								// @todo thanks?
								icon.remove();
								break;

							case 0 :
								icon.remove();
								break;
						}
					});
				});
			}

			// сразу обновляем иконку оповещений
			var newsIcon = $("span.news")
			this.updateNewsIcon(newsIcon);

			newsIcon.bind("click", function() {
				self.view("news", {
					uiType: "full",
					headers: {
						one: [
							{"type" : "text", "name" : chrome.i18n.getMessage("newNotifications")}
						]
					}
				});
			});


			// показываем список контактов
			this.view("contactsList", {
				"uiType" : "partial",
				"headers" : {
					"left" : [
						{"type" : "text", "name" : chrome.i18n.getMessage("contactsName")},
						{"type" : "icon", "name" : "search", "title" : chrome.i18n.getMessage("searchContact")}
					]
				}
			});

			// показываем диалоги
			this.view("mailList", {
				"uiType" : "partial",
				"headers" : {
					"right" : [
						{"type" : "text", "name" : chrome.i18n.getMessage("correspondence")},
						{"type" : "icon", "name" : "list", "title" : chrome.i18n.getMessage("correspondenceManagement")},
						/*{"type" : "icon", "name" : "write", "title" : chrome.i18n.getMessage("writeMessage")},*/
						{"type" : "icon", "name" : "search", "title" : chrome.i18n.getMessage("searchMail")}
					]
				}
			});

			chrome.extension.sendMessage({"action" : "userUIDrawn"});
		}
	},

	get AccountsManager() {
		delete this.AccountsManager;
		return this.AccountsManager = chrome.extension.getBackgroundPage().AccountsManager;
	},

	get SoundManager() {
		delete this.SoundManager;
		return this.SoundManager = chrome.extension.getBackgroundPage().SoundManager;
	},

	get CacheManager() {
		delete this.CacheManager;
		return this.CacheManager = chrome.extension.getBackgroundPage().CacheManager;
	},

	get SettingsManager() {
		delete this.SettingsManager;
		return this.SettingsManager = chrome.extension.getBackgroundPage().SettingsManager;
	},

	get prevShownView() {
		var shownViews = this.Views.shownViews;
		return shownViews[shownViews.length - 2];
	},

	get lastShownView() {
		var shownViews = this.Views.shownViews;

		return (shownViews.length)
			? shownViews[shownViews.length - 1]
			: null;
	},

	updateNewsIcon: function (iconElem) {
		var i18nTitleTerms = chrome.i18n.getMessage("newsIconTitles").split("|");
		var storedPostsArray = StorageManager.get("vkgroupwall_stored_posts", {constructor: Array, strict: true, create: true});

		if (!storedPostsArray.length)
			return StorageManager.remove("vkgroupwall_stored_posts");

		iconElem
			.text(storedPostsArray.length)
			.attr("title", storedPostsArray.length + " " + Utils.string.plural(storedPostsArray, i18nTitleTerms))
			.removeClass("is-empty");
	},

	addReceivedMessage: function (msgData) {
		var self = this,
			isInboxMsg = (msgData.tags & self.CacheManager.tags.inbox),
			msgSenderUid = (isInboxMsg) ? msgData.uid : self.AccountsManager.currentUserId,
			chatContainer = $("#content > section.chat-container"),
			msgDataObj = self._prepareMessage(msgData, true),
			lastUserSpeechSection = $(chatContainer, "section.user-speech:last-of-type"),
			lastSpeechUid = (lastUserSpeechSection) ? parseInt(lastUserSpeechSection.data("uid"), 10) : null,
			lastSpeechTs = (lastUserSpeechSection) ? parseInt(lastUserSpeechSection.lastElementChild.data("ts"), 10) : 0,
			createNewSpeechSection, userSpeechSection;

		createNewSpeechSection = ((msgSenderUid !== lastSpeechUid) || (lastSpeechTs - msgData.date > 8 * 60 * 60));
		if (createNewSpeechSection) {
			userSpeechSection = self._drawUserSpeechSection(msgData);
			if (lastUserSpeechSection) {
				lastUserSpeechSection.after(userSpeechSection);
			} else { // первое сообщение
				chatContainer.prepend(userSpeechSection);
			}
		} else {
			userSpeechSection = lastUserSpeechSection;
		}

		var msgContents = Templates.render("chatMessage", msgDataObj);
		userSpeechSection.append(msgContents);

		$$(userSpeechSection, "section.msg").bind("mouseover", self._chatMessageMouseOverListener);
	},

	/**
	 * Отрисовка E-mail сообщений в левой части
	 *
	 * @param {Object} msgData
	 * @param {String} searchTerm (необяз.)
	 *
	 * @return {Object}
	 */
	_prepareHalfSection: function (msgData, searchTerm) {
		var self = this;
		var isInboxMsg = Boolean(msgData.tags & self.CacheManager.tags.inbox);
		var uid = isInboxMsg ? msgData.uid : self.AccountsManager.currentUserId;

		var avatarSrc = "pic/question_th.gif";
		if (self.CacheManager.avatars[uid] !== undefined) {
			if (self.CacheManager.avatars[uid].length) {
				avatarSrc = self.CacheManager.avatars[uid];
			}
		} else {
			chrome.extension.sendMessage({"action" : "loadAvatar", "uid" : uid});
		}

		var contactFio = msgData.first_name + " " + msgData.last_name;
		if (!isInboxMsg)
			contactFio = chrome.i18n.getMessage("recepientTo") + contactFio;

		var textHTML = Utils.string.emoji(msgData.body.split("<br>")[0], true);
		if (searchTerm) {
			searchTerm = searchTerm.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
			
			var regex = new RegExp(searchTerm, "i");
			var matches = textHTML.match(regex);

			if (matches) {
				textHTML = textHTML.replace(matches[0], "<b>" + matches[0] + "</b>");
			}
		}

		var output = {
			is_new: (msgData.status === 0 && msgData.tags & self.CacheManager.tags.inbox),
			mid: msgData.mid,
			avatarSrc: avatarSrc,
			uid: uid,
			humanDate: Utils.string.humanDate(msgData.date),
			fio: contactFio,
			text: textHTML
		};

		// при поиске сообщений
		if (msgData.id)
			output.id = msgData.id;

		return output;
	},

	/**
	 * Отрисовка пользовательской секции в левой части
	 *
	 * @param {Object} userData
	 * @param {Array} searchTerms (необяз.)
	 * @return {Object}
	 */
	_prepareContactSection: function (userData, searchTerms) {
		var fio = userData.first_name + " " + userData.last_name;

		if (searchTerms instanceof Array) {
			searchTerms.forEach(function (term) {
				var term = term.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
				var regex = new RegExp(term.replace(), "i");
				var matches = fio.match(regex);

				if (matches) {
					fio = fio.replace(matches[0], "<b>" + matches[0] + "</b>");
				}
			});
		}

		var phones = [];
		var otherData = {};

		try {
			otherData = JSON.parse(userData.other_data);
		} catch (e) {}

		if (otherData.home_phone && otherData.home_phone.length)
			phones.push(otherData.home_phone);

		if (otherData.mobile_phone && otherData.mobile_phone.length)
			phones.push(otherData.mobile_phone);

		var avatarSrc = "pic/question_th.gif";
		if (this.CacheManager.avatars[userData.uid]) {
			avatarSrc = this.CacheManager.avatars[userData.uid];
		} else {
			chrome.extension.sendMessage({"action" : "loadAvatar", "uid" : userData.uid});
		}

		return {
			uid: userData.uid,
			avatarSrc: avatarSrc,
			showMoreInfo: chrome.i18n.getMessage("showMoreInfoAboutContactOrMessage"),
			fio: fio,
			phones: phones.join(", "),
			hidden: (this.AccountsManager.currentUserId === userData.uid)
		};
	},

	/**
	 * Отрисовка сообщений чатов
	 * @return {Object}
	 */
	_prepareMessage: function (msgData, forceShowUnread) {
		var self = this;
		var isInbox = (msgData.tags & self.CacheManager.tags.inbox);
		var unread = forceShowUnread || (msgData.status === 0 && isInbox);

		var attachments = [];
		var msgObj;

		try {
			msgObj = JSON.parse(msgData.other_data);
		} catch (e) {}

		msgData.body = Utils.string.replaceLinks(msgData.body);
		if (msgObj && msgObj.emoji)
			msgData.body = Utils.string.emoji(msgData.body, true);

		var output = {
			unread: unread,
			id: msgData.mid,
			sent: !isInbox,
			date: msgData.date,
			localizedDate: (new Date(msgData.date * 1000)).toLocaleString().replace(/\sGMT.*/, ""),
			humanDate: Utils.string.humanDate(msgData.date),
			important: (msgData.tags & self.CacheManager.tags.important),
			importantTitle: chrome.i18n.getMessage("importantMessage"),
			body: msgData.body,
			attachments: []
		};

		try {
			msgData.attachments = JSON.parse(msgData.attachments);
		} catch (e) {
			msgData.attachments = [];
		}

		if (!(msgData.attachments instanceof Array) || !msgData.attachments.length)
			return output;

		msgData.attachments.forEach(function (attachmentInfo) {
			var type = (attachmentInfo instanceof Array) ? attachmentInfo[0] : attachmentInfo.type;
			var id = "att_" + Math.random().toString().substr(2);
			var tplData = {};

			if (attachmentInfo instanceof Array) { // LP
				tplData[type] = true;
				tplData.id = id;
				tplData.info = JSON.stringify(attachmentInfo);

				if (type === "photo") {
					tplData.noimage = true;
				}
			} else { // mailSync
				switch (attachmentInfo.type) {
					case "audio":
						var info = [attachmentInfo.type, attachmentInfo[attachmentInfo.type].owner_id, attachmentInfo.audio.aid];
						tplData.audio = true;
						tplData.id = id;
						tplData.info = JSON.stringify(info);
						break;

					case "video":
						var info = [attachmentInfo.type, attachmentInfo[attachmentInfo.type].owner_id, attachmentInfo.video.vid];
						tplData.video = true;
						tplData.id = id;
						tplData.info = JSON.stringify(info);
						break;

					case "photo":
						tplData.photo = true;
						tplData.id = id;
						tplData.noimage = true;
						tplData.info = JSON.stringify(["photo", Utils.misc.searchBiggestImage(attachmentInfo.photo)]);
						break;

					case "doc":
						var regex = new RegExp(attachmentInfo.doc.ext + "$");

						tplData.doc = true;
						tplData.id = id;
						tplData.url = attachmentInfo.doc.url;
						tplData.fileName = (regex.test(attachmentInfo.doc.title)) ? attachmentInfo.doc.title : attachmentInfo.doc.title + "." + attachmentInfo.doc.ext;
						tplData.title = attachmentInfo.doc.title;
						tplData.description = Utils.string.humanFileSize(attachmentInfo.doc.size) + ", " + chrome.i18n.getMessage("fileType") + ": " + attachmentInfo.doc.ext.toUpperCase();
						break;

					case "geopoint":
						tplData.geopoint = true;
						tplData.id = id;
						tplData.info = JSON.stringify(["geopoint"]);
						tplData.nopoint = true;
						break;
				}
			}

			output.attachments.push(tplData);
		});

		return output;
	},

	/**
	 * Открытие сообщения из папки (не чат)
	 */
	_drawOpenMessage: function (msgId) {
		var self = this;
		var leftSection = $("#content > section.left");
		var rightSection = $("#content > section.right");
		var currentMsgSection = $(rightSection, "section[data-mid='" + msgId + "']");
		var availableWidth = $(currentMsgSection, "section.data").offsetWidth;
		var fromFio = $(currentMsgSection, "section.from").text();
		var id = currentMsgSection.data("did");

		currentMsgSection.addClass("half-loading");
		$(currentMsgSection, "section.text").text(chrome.i18n.getMessage("pleaseWait") + "...");

		chrome.extension.sendMessage({
			action: "getMessageInfo",
			mid: msgId
		}, function (msgInfo) {
			var isTrashFolderContents = (leftSection.hasClass("manage-mail") && parseInt($(leftSection, "li.active").data("tid"), 10) === self.CacheManager.tags.trash);

			var msgTplData = self._prepareHalfSection(msgInfo);
			msgTplData.fio = fromFio;
			msgTplData.text = Utils.string.emoji(Utils.string.replaceLinks(msgInfo.body), true);
			msgTplData.trash = isTrashFolderContents;
			msgTplData.printText = chrome.i18n.getMessage("printMessage");
			msgTplData.restoreText = chrome.i18n.getMessage("restoreMessage")
			msgTplData.deleteText = chrome.i18n.getMessage("deleteMessage");
			msgTplData.replyText = chrome.i18n.getMessage("respondMessage");
			msgTplData.startTyping = chrome.i18n.getMessage("startTypingMessage");
			msgTplData.important = (!isTrashFolderContents && (msgInfo.tags & self.CacheManager.tags.important));
			msgTplData.importantText = chrome.i18n.getMessage("importantMessage");
			msgTplData.attachments = [];

			if (id.length)
				msgTplData.id = id;

			// преобразуем вложения
			try {
				msgInfo.attachments = JSON.parse(msgInfo.attachments);
			} catch (e) {
				msgInfo.attachments = [];
			}

			(msgInfo.attachments || []).forEach(function (attachmentData) {
				var id = "rnd_" + Math.random().toString().substr(2);
				var attachmentType = (attachmentData instanceof Array) ? attachmentData[0] : attachmentData.type;
				var requestData, attachmentTplData;
				var data = attachmentData[attachmentData.type];

				// сразу добавляем поля для шаблона
				switch (attachmentType) {
					case "audio":
						attachmentTplData = {audio: true, id: id};
						break;

					case "video":
						attachmentTplData = {video: true, id: id};
						break;

					case "photo":
						attachmentTplData = {photo: true, id: id, noimage: true};
						break;

					case "doc":
						attachmentTplData = {doc: true, id: id, nolink: true};
						break;

					case "geopoint":
						attachmentTplData = {geopoint: true, id: id};
						break;
				}

				if (attachmentData instanceof Array) { // LP
					requestData = attachmentData;
				} else { // mailSync
					switch (attachmentData.type) {
						case "audio":
							requestData = ["audio", data.owner_id, data.aid];
							break;

						case "video":
							requestData = ["video", data.owner_id, data.vid];
							break;

						case "photo":
							attachmentTplData.src = Utils.misc.searchBiggestImage(data);

							// когда данных о размере картинки нет, загружаем ее и после этого высчитываем пропорции
							if (!data.width || !data.height) {
								var image = new Image();
								image.onload = function () {
									var attachmentArea = $("#" + id).removeClass("hidden");
									var attachmentImg = $(attachmentArea, "img");
									var imgAspect = image.width / image.height;
									var imgWidth = Math.min(availableWidth, image.width);

									attachmentImg.attr({
										width: imgWidth,
										height: imgWidth / image.height
									});
								};

								image.src = attachmentTplData.src;
							} else {
								delete attachmentTplData.noimage;

								var imgAspect = data.width / data.height;
								attachmentTplData.width = Math.min(data.width, availableWidth);
								attachmentTplData.height = Math.round(attachmentTplData.width / imgAspect);
							}

							break;

						case "doc":
							var regex = new RegExp(data.ext + "$");

							delete attachmentTplData.nolink;
							attachmentTplData.url = data.url;
							attachmentTplData.fileName = (regex.test(data.title)) ? data.title : data.title + "." + data.ext;
							attachmentTplData.title = data.title;
							attachmentTplData.description = Utils.string.humanFileSize(data.size) + ", " + chrome.i18n.getMessage("fileType") + ": " + data.ext.toUpperCase();

							break;

						case "geopoint":
							// на этом этапе HTML еще не существует
							Utils.async.nextTick(function () {
								self._drawGeoPointAsync(id, data.lat, data.lng);
							});

							break;
					}
				}

				if (attachmentTplData)
					msgTplData.attachments.push(attachmentTplData);

				if (!requestData)
					return;

				// делаем доп. запросы к API для получения прямых ссылок на вложения
				switch (requestData[0]) {
					case "photo":
						chrome.extension.sendMessage({
							action: "getPhotoById",
							ownerId: requestData[1],
							id: requestData[2],
							mid: msgId
						}, function (photoInfo) {
							if (!photoInfo)
								return;

							var attachmentArea = $("#" + id).removeClass("hidden");
							var attachmentImg = $(attachmentArea, "img");
							var imgAspect = photoInfo.width / photoInfo.height;
							var imgWidth = Math.min(availableWidth, photoInfo.width);

							attachmentImg.attr({
								width: imgWidth,
								height: imgWidth / imgAspect,
								src: Utils.misc.searchBiggestImage(photoInfo)
							});
						});

						break;

					case "audio":
						chrome.extension.sendMessage({
							action: "getAudioById",
							ownerId: requestData[1],
							id: requestData[2]
						}, function (audioInfo) {
							if (!audioInfo)
								return;

							var attachmentArea = $("#" + id).removeClass("hidden");

							$(attachmentArea, "span.description").text(audioInfo.artist + " - " + audioInfo.title);
							$(attachmentArea, "audio").attr("src", audioInfo.url);
						});

						break;

					case "video":
						chrome.extension.sendMessage({
							action: "getVideoById",
							ownerId: requestData[1],
							id: requestData[2]
						}, function (videoInfo) {
							if (!videoInfo)
								return;

							var attachmentArea = $("#" + id).removeClass("hidden");
							var descriptionText = (videoInfo.description.indexOf(videoInfo.title) === -1) ? videoInfo.title + "<br>" + videoInfo.description : videoInfo.description;

							$(attachmentArea, "iframe").attr("src", videoInfo.player);
							$(attachmentArea, "span.description").html(Utils.string.replaceLinks(descriptionText.replace(/(<br>){2,}/gm, "<br>")));
						});

						break;

					case "doc" :
						chrome.extension.sendMessage({
							action: "getDocById",
							ownerId: requestData[1],
							id: requestData[2],
							mid: msgId
						}, function (fileInfo) {
							if (!fileInfo)
								return;

							var regex = new RegExp(fileInfo.ext + "$");
							var attachmentArea = $("#" + id).removeClass("hidden");
							var fileName = (regex.test(fileInfo.title)) ? fileInfo.title : fileInfo.title + "." + fileInfo.ext;

							$(attachmentArea, "a").attr({
								href: fileInfo.url,
								download: fileName
							}).text(data.title);

							var descriptionText = Utils.string.humanFileSize(fileInfo.size) + ", " + chrome.i18n.getMessage("fileType") + ": " + fileInfo.ext.toUpperCase();
							$(attachmentArea, "span.description").text(descriptionText);
						});

						break;

					case "geopoint":
						chrome.extension.sendMessage({
							action: "getGeopointById",
							mid: msgId
						}, function (pointInfo) {
							if (!pointInfo)
								return;

							var attachmentArea = $("#" + id).removeClass("hidden");
							self._drawGeoPointAsync(id, pointInfo[0], pointInfo[1]);
						});

						break;
				}
			});

			var msgSection = Templates.render("halfSectionOpened", msgTplData);
			currentMsgSection.after(msgSection).remove();

			// помечаем сообщение как прочитанное
			if (msgInfo.status === 0 && (msgInfo.tags & self.CacheManager.tags.inbox))
				chrome.extension.sendMessage({action: "markAsRead", mid: msgInfo.mid});

			// закрываем уведомление
			chrome.extension.sendMessage({action: "closeNotification", mid: msgInfo.mid});
		});
	},

	/**
	 * @return {String}
	 */
	_drawThreads: function (threads) {
		var threadsTplData = [];
		var self = this;

		threads.forEach(function (thread) {
			var threadData = {
				id: thread.id,
				humanDate: Utils.string.humanDate(thread.date),
				participants: [],
				totalMessages: thread.total,
				subject: null,
				body: Utils.string.emoji(thread.body, true)
			};

			if (/^[\d]+$/.test(thread.id)) {
				var threadTitle = thread.title.trim().replace(/(Re(\([\d]+\))?:[\s]+)+/, "").replace(/VKontakte\sOffline\smessage/, "VK Offline message");
				threadData.subject = (["...", ""].indexOf(threadTitle) !== -1) ? chrome.i18n.getMessage("commonDialog") : threadTitle;
			}

			thread.participants.forEach(function (contactData) {
				var isCurrentUser = (contactData.uid === self.AccountsManager.currentUserId);
				var fio = isCurrentUser ? null : contactData.first_name + " " + contactData.last_name;
				var userName = isCurrentUser ? chrome.i18n.getMessage("participantMe") : contactData.first_name;

				threadData.participants.push({
					fio: fio,
					uid: contactData.uid,
					name: userName
				});
			});

			threadsTplData.push(threadData);
		});

		return Templates.render("threadsList", {threads: threadsTplData});
	},

	_drawUserSpeechSection: function (msgData) {
		var isInboxMsg = (msgData.tags & this.CacheManager.tags.inbox);
		var msgSenderUid = isInboxMsg ? msgData.uid : this.AccountsManager.currentUserId;
		var fio = isInboxMsg ? msgData.first_name + " " + msgData.last_name : this.AccountsManager.current.fio;

		var avatarSrc = "pic/question_th.gif";
		if (this.CacheManager.avatars[msgSenderUid] !== undefined) {
			if (this.CacheManager.avatars[msgSenderUid].length) {
				avatarSrc = this.CacheManager.avatars[msgSenderUid];
			}
		} else {
			chrome.extension.sendMessage({"action" : "loadAvatar", "uid" : msgSenderUid});
		}

		var html = Templates.render("userSpeech", {
			uid: msgSenderUid,
			avatarSrc: avatarSrc,
			fio: fio
		});

		return $(html);
	},

	/**
	 * Отрисовка карты с геоточкой
	 *
	 * @param {String} domElemId ID элемента, в который будет встроена карта
	 * @param {Float} lat
	 * @param {Float} lng
	 */
	_drawGeoPointAsync: function (domElemId, lat, lng) {
		var onYMapsReady = function() {
			ymaps.ready(function () {
				var map = new ymaps.Map(domElemId, {
					center: [lat, lng],
					zoom: 12
				});

				map.controls.add('mapTools');
				map.controls.add('typeSelector');
				map.controls.add('zoomControl');

				var point = new ymaps.GeoObject({
					geometry: {
						type: "Point",
						coordinates: [lat, lng]
					}
				});

				map.geoObjects.add(point);
			});
		};

		if (typeof ymaps === "undefined") {
			// можно грузить ЯК для других локалей, но не всегда есть сами карты для не RU-локали
			// var uiLocale = chrome.i18n.getMessage("@@ui_locale").split("_")[0];
			var ymapsLibSrc = "https://api-maps.yandex.ru/2.0-stable/?load=package.standard,package.geoObjects&lang=ru-RU";

			var ymapsLib = document.createElement("script");
			ymapsLib.setAttribute("src", ymapsLibSrc);
			ymapsLib.onload = onYMapsReady;

			$("head").append(ymapsLib);
		} else {
			onYMapsReady();
		}
	},

	/**
	 * @param {String} formType "simple", "face-to-face"
	 */
	_drawMessageSendForm: function (formType) {
		var self = this;
		var threadContainer = $("#content > section.right");
		var saveMessageKey = "message_" + this.AccountsManager.currentUserId + "_" + threadContainer.data("dialogId");
		var savedMessageText = StorageManager.get(saveMessageKey) || "";
		var isChat = threadContainer.hasClass("chat-container");
		var face2face = (formType === "face-to-face");

		var tplData = {
			face2face: face2face,
			subjectText: chrome.i18n.getMessage("subject"),
			types: [],
			savedMessageText: savedMessageText,
			waitForImplementationText: chrome.i18n.getMessage("tourStep4Description").split("|")[1] + " " + chrome.i18n.getMessage("tourStep4SmallDescription"),
			sendBtnText: Utils.string.ucfirst(chrome.i18n.getMessage("sendMessageButtonTitle")),
			isChat: isChat,
			closeBtnText: Utils.string.ucfirst(chrome.i18n.getMessage("close"))
		};

		["text", "attachments", "video", "audio"].forEach(function (msgType) {
			var i18nTerm = "messageType" + Utils.string.ucfirst(msgType);

			tplData.types.push({
				type: msgType,
				active: (msgType === "text"),
				inactive: !navigator.onLine,
				messageTypeText: chrome.i18n.getMessage(i18nTerm)
			});
		});

		var formHTML = Templates.render("messageSendForm", tplData);
		var form = $(formHTML);
		var timeoutId;


		// обработка перетащенных или выбранных файлов (загрузка)
		var onFilesAdded = function (itemsList, parentSection) {
			var appendSections = [];
			var isChromium21plus = (parentSection !== undefined); // Chromium 21-

			/**
			 * @param {File} fileData
			 * @return {HTMLExtendedElement}
			 */
			var fileProcessFn = function(fileData) {
				var i18nTerm = chrome.i18n.getMessage("getUploadDataFromServer").replace(/%filename%/, fileData.name),
					uniqueId = "vk_" + Math.random().toString().substr(2),
					info = $("<section>").text(i18nTerm + "..."),
					progressBar = $("<progress>").attr("max", fileData.size),
					isImage = (/^image\/(jpe?g|gif|bmp|png)$/.test(fileData.type)),
					getServerDataAction = (isImage) ? "getMessagesUploadServer" : "getDocsUploadServer";
				
				// @todo обработчики 3 фэйлов: не получилось получить сервер, фэйл аплоада, фэйл сохранения
				chrome.extension.sendMessage({"action" : getServerDataAction}, function (data) {
					if (!data)
						return;

					var xhr = new XMLHttpRequest(),
						formDataField = isImage ? "photo" : "file";

					xhr.open("POST", data.response.upload_url, true);
					xhr.addEventListener("load", function () {
						var uploadRes,
							parseExceptionMessage,
							errorText,
							closeErrorBtn;

						// обновляем строку данных
						info.text(chrome.i18n.getMessage("saveUploadedData") + "...");

						progressBar.removeAttr("value");
						try {
							uploadRes = JSON.parse(xhr.responseText);
						} catch (e) {
							parseExceptionMessage = e.message;
						}

						if (!uploadRes) {
							errorText = chrome.i18n.getMessage("fileUploadFailed").replace(/%filename%/, "<b>" + fileData.name + "</b>");
							closeErrorBtn = $("<span>").addClass("close").bind("click", function() {
								this.closestParent("section.file").remove();
							});
							
							info.addClass("error").html(errorText).prepend(closeErrorBtn);
							progressBar.remove();

							// уведомляем GA
							chrome.extension.sendMessage({
								action: "errorGot",
								error: "Failed to upload file",
								message: "Failed parsing response: " + parseExceptionMessage
							});

							return;
						}

						if (uploadRes.error) {
							errorText = chrome.i18n.getMessage("fileUploadRejected").replace(/%filename%/, "<b>" + fileData.name + "</b>");
							closeErrorBtn = $("<span>").addClass("close").bind("click", function() {
								this.closestParent("section.file").remove();
							});
							
							info.addClass("error").html(errorText).prepend(closeErrorBtn);
							progressBar.remove();

							// уведомляем GA
							chrome.extension.sendMessage({
								action: "errorGot",
								error: "Failed to upload file",
								message: "Failed storing file: " + uploadRes.error
							});

							return;
						}

						uploadRes.action = (isImage) ? "saveMessagesPhoto" : "saveMessagesDoc";
						chrome.extension.sendMessage(uploadRes, function (data) {
							if (!data)
								return;

							// обновляем счетчик
							var mngElem = $("#content > section.right li.attachments span"),
								currentValue = mngElem.text(),
								section, attachmentId;

							if (currentValue.length) {
								mngElem.text(parseInt(currentValue, 10) + 1);
							} else {
								mngElem.text("1");
							}

							attachmentId = (isImage)
								? "photo" + data.response[0].owner_id + "_" + data.response[0].pid
								: "doc" + data.response[0].owner_id + "_" + data.response[0].did;

							var removeFile = $("<span>").addClass("remove").attr("title", chrome.i18n.getMessage("deleteMessage")).bind("click", function () {
								this.parentNode.remove();

								// обновляем счетчик
								var mngElem = $("#content > section.right li.attachments span"),
									currentValue = mngElem.text(),
									newValue = parseInt(currentValue, 10) - 1;

								if (newValue > 0) {
									mngElem.text(newValue);
								} else {
									mngElem.empty();
								}
							});

							section = $("#" + uniqueId);
							if (section) {
								section.empty().append(removeFile).data("id", attachmentId).insertAdjacentHTML("afterbegin", fileData.name);
							}
						});
					}, false);

					// TODO перепроверить
					xhr.addEventListener("error", function() {
						var errorText,
							closeErrorBtn;

						errorText = chrome.i18n.getMessage("fileUploadFailed").replace(/%filename%/, "<b>" + fileData.name + "</b>");
						closeErrorBtn = $("<span>").addClass("close").bind("click", function() {
							this.closestParent("section.file").remove();
						});
						
						info.addClass("error").html(errorText).prepend(closeErrorBtn);
						progressBar.remove();

						// уведомляем GA
						chrome.extension.sendMessage({"action" : "errorGot", "error" : "Failed to upload file", "message" : "Failed to perform request"});
					}, false);

					xhr.upload.onprogress = function(e) {
						if (e.lengthComputable) {
							progressBar.val(e.loaded);

							// обновляем строку данных
							var total = progressBar.attr("max"),
								percents = Math.round(e.loaded / total * 100) + "%",
								fileSizeUploaded = Utils.string.humanFileSize(e.loaded),
								totalSize = Utils.string.humanFileSize(total),
								i18nTerm = chrome.i18n.getMessage("uploadedPercents").replace(/%bytes%/, fileSizeUploaded).replace(/%percents%/, percents).replace(/%total%/, totalSize);

							info.text(i18nTerm);
						}
					};

					var sendData = new FormData();
					sendData.append(formDataField, fileData);
					xhr.send(sendData);
				});

				return $("<section>").attr("id", uniqueId).addClass("file").append([info, progressBar]);
			};


			if (isChromium21plus === false) {
				Array.prototype.forEach.call(itemsList, function(fileData) {
					var section = fileProcessFn(fileData);
					appendSections.push(section);
				});

				return appendSections;
			}

			/**
			 * @param {EntryArray} или {DataTransferItemsList}
			 */
			var walkThroughItemsFn = function (items) {
				Array.prototype.forEach.call(items, function (item) {
					// DataTransferItem
					if (!item.isFile && !item.isDirectory)
						item = item.webkitGetAsEntry();

					if (item.isDirectory) {
						item.createReader().readEntries(walkThroughItemsFn);
					} else {
						if (item.name.charAt(0) === ".")
							return;

						item.file(function (fileData) {
							var section = fileProcessFn(fileData);
							parentSection.prepend(section);
						});
					}
				});
			};

			walkThroughItemsFn(itemsList);
		};

		$$(form, "ul.selectable li").bind("click", function (e) {
			var listElem = this;
			var msgType = this.data("type");
			var mngSection = $("#content > section.right section.manage." + msgType);

			// меняем активный таб
			$$("#content ul.selectable li").each(function () {
				if (this === listElem) {
					this.addClass("active");
				} else {
					this.removeClass("active");
				}
			});

			// скрываем/открываем сами секции с данными
			$$("#content > section.right section.manage").each(function () {
				if (this.hasClass(msgType)) {
					this.removeClass("hidden");
				} else {
					this.addClass("hidden");
				}
			});

			// фиксим скролл
			if (isChat) {
				threadContainer.scrollTop = threadContainer.scrollHeight;
			}
		});

		$(form, "section.manage.attachments").bind("dragenter", function (e) {
			e.stopPropagation();
			e.preventDefault();
		}).bind("dragover", function (e) {
			e.stopPropagation();
			e.preventDefault();

			this.addClass("drag-over");
		}).bind("dragleave", function (e) {
			e.stopPropagation();
			e.preventDefault();

			this.removeClass("drag-over");
		}).bind("drop", function (e) {
			var prependSections;
			var args, entrySample; // Chrome21 folder DND support

			e.stopPropagation();
			e.preventDefault();

			this.removeClass("drag-over");

			try {
				entrySample = e.dataTransfer.items.item(0).webkitGetAsEntry();
				args = [e.dataTransfer.items, this];
			} catch (e) {
				args = [e.dataTransfer.files];
			} finally {
				prependSections = onFilesAdded.apply(this, args);
			}

			// статистика
			chrome.extension.sendMessage({
				action: "DNDhappened",
				num: args[0].length
			});

			if (prependSections) {
				this.prepend(prependSections);
			}
		});

		// Ctrl+Enter support
		$(form, "textarea").bind("keydown", function (e) {
			var isMac = (navigator.appVersion.indexOf("Mac") !== -1);
			var serviceKeyPressed = isMac ? e.metaKey : e.ctrlKey;

			if (e.keyCode === 13 && serviceKeyPressed) {
				var sendBtn = $(form, "button.send");
				if (sendBtn)
					sendBtn.click();

				e.stopPropagation();
			}
		}).bind("keyup", function () {
			var self = this;

			if (timeoutId) {
				window.clearTimeout(timeoutId);
				form.removeData("timeoutId");
			}	

			timeoutId = window.setTimeout(function () {
				StorageManager.set(saveMessageKey, self.val());
			}, 1000);

			// прокидываем timeoutId, чтобы в submit можно было его очистить
			form.data("timeoutId", timeoutId);
		});

		$(form, "input[x-webkit-speech]").bind("focus", function () {
			$(form, "textarea").focus();
		}).bind("webkitspeechchange", function () {
			var replyAreaTextarea = $(form, "textarea");
			var spokenWords = this.val();
			var existingWords = replyAreaTextarea.val();
			var newWords = existingWords.substr(0, replyAreaTextarea.selectionStart) + spokenWords + " " + existingWords.substr(replyAreaTextarea.selectionEnd);

			replyAreaTextarea.val(newWords);
			this.val("");

			chrome.extension.sendMessage({"action" : "speechChange"});

			// dispatch fake keyup event
			var evt = document.createEvent("KeyboardEvent");
			evt.initKeyboardEvent("keypress", true, true, null, false, false, false, false, 9, 0);
			replyAreaTextarea.dispatchEvent(evt);
		});

		$(form, "input[type='file']").bind("change", function onChangeHandler(e) {
			var appendSections = onFilesAdded(e.target.files);
			var attachmentsManageSection = this.closestParent("section.manage");

			// удаляем старый input[type="file"]
			this.after(appendSections).remove();

			// добавляем новый input[type="file"]
			var newAttachFileInput = $("<input type='file' multiple>").bind("change", onChangeHandler);
			attachmentsManageSection.append(newAttachFileInput);
		});

		// click на кнопку генерируется перед общим submit у формы
		$(form, "button.send").bind("click", function () {
			$(form, "ul li.text").click();
		});

		var closeBtn = $(form, "button.close");
		if (closeBtn) {
			closeBtn.bind("click", function () {
				var beforeFormElem = form.previousElementSibling;

				form.remove();
				beforeFormElem.scrollIntoView()

				if (!face2face)
					return;

				var uid = threadContainer.data("dialogId").split("_")[1];
				self.view("showContact", {
					uiType: "partial",
					headers: {
						left: [
							{"type" : "text", "name" : "..."},
							{"type" : "icon", "name" : "write", "title" : chrome.i18n.getMessage("writeMessage")}
						],
						right: [
							{"type" : "text", "name" : chrome.i18n.getMessage("correspondence")}
						]
					}
				}, [uid]);
			});
		}

		return form;
	},

	// @todo эта мешанина методов и обработчиков - нехорошо
	_chatMessageMouseOverListener: function (e) {
		if (this.hasClass("sent"))
			return;

		var msgId = this.data("mid");
		if (!this.hasClass("new"))
			return;

		this.removeClass("new");
		chrome.extension.sendMessage({
			action: "markAsRead",
			mid: msgId
		});
	},

	_currentMainType: null
};
