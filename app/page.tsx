"use client";

import ChatInput from "@/components/ChatInput";
import ChatMessageElement from "@/components/ChatMessageElement";
import Environment from "@/components/Environment";
import ImageModal from "@/components/ImageModal";
import KeybindsModal from "@/components/KeybindsModal";
import MyUser from "@/components/MyUser";
import UserElement from "@/components/UserElement";
import Login from "@/components/login";
import api from "@/lib/api";
import { randomEmoji } from "@/lib/emoji";
import mentions from "@/lib/mentions";
import {
  Action,
  ChatMessage,
  ChatMessageChunk,
  MySettings,
  Presence,
  User,
} from "@/types/types";
import {
  Call,
  CallEnd,
  Headset,
  HeadsetOff,
  Mic,
  MicOff,
} from "@mui/icons-material";
import { Button } from "@nextui-org/button";
import { useDisclosure } from "@nextui-org/modal";
import { ScrollShadow } from "@nextui-org/scroll-shadow";
import { Spinner } from "@nextui-org/spinner";
import { Tooltip } from "@nextui-org/tooltip";
import clsx from "clsx";
import moment from "moment";
import Peer, { DataConnection, MediaConnection } from "peerjs";
import {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export default function Home() {
  const chunkSize = 50000;

  // Loading
  const [socket, setSocket] = useState<WebSocket>();
  const [sessionToken, setSessionToken] = useState("");
  const [opened, setOpened] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loadedMessages, setLoadedMessages] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Messages
  const [messagesOffset, setMessagesOffset] = useState(0);
  const [chatMessageChunks, setChatMessageChunks] = useState<
    ChatMessageChunk[]
  >([]);
  const [chatMessagesScrollPos, setChatMessagesScrollPos] = useState(0);
  const [chatMessagesHeight, setChatMessagesHeight] = useState(0);
  const [shouldScrollToEnd, setShouldScrollToEnd] = useState(true);
  const [shouldKeepScrollPos, setShouldKeepScrollPos] = useState(false);
  const [editedMessages, setEditedMessages] = useState<ChatMessage[]>([]);

  // Input
  const [replyingTo, setReplyingTo] = useState<ChatMessage | undefined>();

  // Users
  const [myUserId, setMyUserId] = useState("");
  const [mySettings, setMySettings] = useState<MySettings | undefined>();
  const [myUser, setMyUser] = useState<User | undefined>();
  const [users, setUsers] = useState<Record<string, User>>({});

  function getAudioElement(src: string) {
    if (typeof Audio !== "undefined") {
      return new Audio(src);
    }
  }

  // Sound Effects
  const chimes = useMemo<(HTMLAudioElement | undefined)[]>(
    () => [
      getAudioElement("/chime1.flac"),
      getAudioElement("/chime2.flac"),
      getAudioElement("/chime3.flac"),
      getAudioElement("/chime4.flac"),
      getAudioElement("/chime5.flac"),
    ],
    [],
  );
  const joinSound = useMemo<HTMLAudioElement | undefined>(
    () => getAudioElement("/join.flac"),
    [],
  );
  const leaveSound = useMemo<HTMLAudioElement | undefined>(
    () => getAudioElement("/leave.flac"),
    [],
  );
  const ringtone = useMemo<HTMLAudioElement | undefined>(
    () => getAudioElement("/ringtone.flac"),
    [],
  );

  // Call Controls
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  // Peer Info
  const [peer, setPeer] = useState<Peer>();
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [audioStreams, setAudioStreams] = useState<Record<string, MediaStream>>(
    {},
  );
  const [audios, setAudios] = useState<Record<string, HTMLAudioElement>>({});
  const [userPeerIds, setUserPeerIds] = useState<Record<string, string>>({});

  // Keybinds Modal
  const {
    isOpen: keybindsIsOpen,
    onOpen: keybindsOnOpen,
    onClose: keybindsOnClose,
  } = useDisclosure();

  // Image Modal
  const {
    isOpen: imageIsOpen,
    onOpen: imageOnOpen,
    onClose: imageOnClose,
  } = useDisclosure();
  const [imageModalSrc, setImageModalSrc] = useState<string>();

  // Refs
  const chatInputTextarea = useRef<HTMLTextAreaElement>(null);
  const chatMessagesDiv = useRef<HTMLDivElement>(null);
  const chatMessagesSpinnerDiv = useRef<HTMLDivElement>(null);
  const chatMessagesDivEnd = useRef<HTMLDivElement>(null);
  const modifierKey = useRef("");

  // Wrapper to send websocket messages
  const send = useCallback(
    (action: Action, data: any) => {
      socket?.send(JSON.stringify({ sessionToken, action, data }));
    },
    [sessionToken, socket],
  );

  function addAudio(peerId: string, remoteStream: MediaStream) {
    // Play remote streams from peers
    const audio = new Audio();
    audio.srcObject = remoteStream;
    audio.autoplay = peerId !== "me";
    setAudios((prev) => ({ ...prev, [peerId]: audio }));
  }

  useEffect(() => {
    if (!sessionToken) return;
    let socket: WebSocket, peer: Peer;
    api.socket().then((ws) => {
      socket = ws;
      setSocket(ws);
    });
    Environment().then((env) => {
      peer = new Peer({
        host: env.peerServerHost,
        port: env.peerServerPort,
        path: env.peerServerPath,
        ...(env.peerServerConfig && {
          config: env.peerServerConfig,
        }),
      });
      setPeer(peer);
    });
    return () => {
      socket.close();
      peer.destroy();
    };
  }, [sessionToken]);

  const changeCallStatus = useCallback(
    (newValue: boolean) => {
      if (!peer || newValue === isInCall) return;
      setIsInCall(newValue);
      if (newValue) {
        if (
          Object.values(users).find(
            (user) => user.presence === Presence.InCall,
          ) !== undefined
        ) {
          // There are users in the call
          ringtone?.pause();
          if (joinSound) {
            joinSound.currentTime = 0;
            joinSound.play();
          }
        } else {
          // We are starting the call
          ringtone?.play();
        }
        navigator.mediaDevices
          .getUserMedia({
            video: false,
            audio: mySettings?.audioSettings ?? true,
          })
          .then((localStream) => {
            setLocalStream(localStream);
            setUserPeerIds((prev) => ({ ...prev, [myUserId]: "me" }));
            setAudioStreams((prev) => ({ ...prev, me: localStream }));
            addAudio("me", localStream);

            peer.removeAllListeners("call");
            function handleCall(call: MediaConnection) {
              call.on("stream", (remoteStream) => {
                setAudioStreams((prev) => ({
                  ...prev,
                  [call.peer]: remoteStream,
                }));
                addAudio(call.peer, remoteStream);
              });
              call.answer(localStream);
            }
            peer.on("call", handleCall);

            send(Action.JoinCall, { peerId: peer.id });
            send(Action.UpdateMyUserInfo, {
              ...myUser,
              presence: Presence.InCall,
            });
          });
      } else {
        ringtone?.pause();
        if (leaveSound) {
          leaveSound.currentTime = 0;
          leaveSound.play();
        }
        localStream?.getTracks().forEach((track) => track.stop());
        for (const peerId in audioStreams) {
          const remoteStream = audioStreams[peerId];
          remoteStream.getTracks().forEach((track) => track.stop());
        }
        setAudioStreams({});
        setAudios({});
        setLocalStream(undefined);

        peer.removeAllListeners("call");

        send(Action.UpdateMyUserInfo, { ...myUser, presence: Presence.Online });
      }
    },
    [
      audioStreams,
      isInCall,
      joinSound,
      leaveSound,
      localStream,
      mySettings?.audioSettings,
      myUser,
      myUserId,
      peer,
      ringtone,
      send,
      users,
    ],
  );

  const toggleMutedOrDeafened = useCallback(
    (toggleMuted: boolean, toggleDeafened: boolean) => {
      const muted = toggleMuted ? !isMuted : isMuted;
      const deafened = toggleDeafened ? !isDeafened : isDeafened;
      setIsMuted(muted);
      setIsDeafened(deafened);
      localStream
        ?.getTracks()
        .forEach((track) => (track.enabled = !muted && !deafened));
      Object.entries(audioStreams).forEach(([peerId, audioStream]) => {
        if (peerId !== "me") {
          audioStream
            .getTracks()
            .forEach((track) => (track.enabled = !deafened));
        }
      });
    },
    [isMuted, isDeafened, localStream, audioStreams],
  );

  // VIM/HELIX STYLE KEYBINDS BABY
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "Escape") {
        modifierKey.current = "";
      }
      if (!modifierKey.current) {
        if (e.key === "i") {
          e.preventDefault();
          chatInputTextarea.current?.focus();
        } else if (e.key === "u" && e.ctrlKey) {
          e.preventDefault();
          const div = chatMessagesDiv.current;
          if (div) {
            div.scrollTo({
              top: div.scrollTop - div.getBoundingClientRect().height / 2,
            });
          }
        } else if (e.key === "d" && e.ctrlKey) {
          e.preventDefault();
          const div = chatMessagesDiv.current;
          if (div) {
            div.scrollTo({
              top: div.scrollTop + div.getBoundingClientRect().height / 2,
            });
          }
        } else if (e.key === "k") {
          e.preventDefault();
          const div = chatMessagesDiv.current;
          if (div) {
            div.scrollTo({
              top:
                div.scrollTop -
                2 *
                parseFloat(
                  getComputedStyle(div, null).getPropertyValue("font-size"),
                ),
            });
          }
        } else if (e.key === "j") {
          e.preventDefault();
          const div = chatMessagesDiv.current;
          if (div) {
            div.scrollTo({
              top:
                div.scrollTop +
                2 *
                parseFloat(
                  getComputedStyle(div, null).getPropertyValue("font-size"),
                ),
            });
          }
        } else if (e.key === "G") {
          e.preventDefault();
          chatMessagesDivEnd.current?.scrollIntoView();
        } else if (e.key === "g") {
          e.preventDefault();
          modifierKey.current = "g";
        } else if (e.key === "v") {
          e.preventDefault();
          changeCallStatus(true);
        } else if (e.key === "b") {
          e.preventDefault();
          changeCallStatus(false);
        } else if (e.key === "n") {
          e.preventDefault();
          toggleMutedOrDeafened(true, false);
        } else if (e.key === "m") {
          e.preventDefault();
          toggleMutedOrDeafened(false, true);
        } else if (e.key === "?") {
          e.preventDefault();
          keybindsOnOpen();
        }
      } else if (modifierKey.current === "g") {
        if (e.key === "g") {
          if (chatMessagesSpinnerDiv.current) {
            chatMessagesSpinnerDiv.current?.scrollIntoView();
          } else {
            chatMessagesDiv.current?.scrollTo({ top: 0 });
          }
          modifierKey.current = "";
        } else if (e.key === "e") {
          e.preventDefault();
          chatMessagesDivEnd.current?.scrollIntoView();
          modifierKey.current = "";
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [changeCallStatus, keybindsOnOpen, ringtone, toggleMutedOrDeafened]);

  useEffect(() => {
    if (!peer) return;
    function handleConnection(conn: DataConnection) {
      conn.on("data", (data: any) => {
        if (data?.userId) {
          setUserPeerIds((prev) => ({ ...prev, [data.userId]: conn.peer }));
        }
      });
    }
    peer.on("connection", handleConnection);
    return () => {
      peer.removeListener("connection", handleConnection);
    };
  }, [peer]);

  // useEffect(() => {
  //   if (!peer || !localStream) return;
  //   function handleCall(call: MediaConnection) {
  //     call.on("stream", (remoteStream) => {
  //       setAudioStreams((prev) => ({ ...prev, [call.peer]: remoteStream }));
  //       addAudio(call.peer, remoteStream);
  //     });
  //     call.answer(localStream);
  //   }
  //   peer.on("call", handleCall);
  //   return () => {
  //     peer.removeListener("call", handleCall);
  //   };
  // }, [localStream, peer]);

  const playChime = useCallback(() => {
    const i = Math.floor(Math.random() * chimes.length);
    const chime = chimes[i];
    if (!chime) return;
    chime.volume = 0.8;
    chime.currentTime = 0;
    chime.play();
  }, [chimes]);

  // Keep current scroll position when loading new message chunks
  const keepScrollPos = useCallback(() => {
    chatMessagesDiv.current?.scrollTo({
      top:
        chatMessagesScrollPos +
        chatMessagesDiv.current?.scrollHeight -
        chatMessagesHeight,
    });
  }, [chatMessagesHeight, chatMessagesScrollPos]);


  useEffect(() => {
    if (shouldScrollToEnd && !shouldKeepScrollPos) {
      chatMessagesDivEnd.current?.scrollIntoView();
      console.log("Scrolled to end")
      setShouldScrollToEnd(false);
    }
  }, [shouldScrollToEnd]);

  useEffect(() => {
    if (shouldKeepScrollPos) {
      keepScrollPos();
    }
  }, [chatMessageChunks.length, keepScrollPos, shouldKeepScrollPos]);

  // Send some initial actions upon connecting
  const handleSocketOnOpen = useCallback(() => {
    if (myUser && !connected) {
      send(Action.GetChatMessages, { chatId: "global", total: chunkSize });
      send(Action.GetAllUsers, {});
      send(Action.UpdateMyUserInfo, {
        ...myUser,
        presence: Presence.Online,
        icon: myUser.icon || randomEmoji(),
      });
      send(Action.GetMySettings, {});
    }
  }, [connected, myUser, send]);

  const handleSocketMessage = useCallback(
    (e: MessageEvent<string>) => {
      // Sometimes the server batches mutilple messages together
      for (const msgText of e.data.split("\n")) {
        let msg: any;
        try {
          msg = JSON.parse(msgText);
        } catch (e) { }

        // Uncomment for debugging
        // console.log(msg);

        const byteLength = new TextEncoder().encode(msgText).length + 1;

        const { action, userId, data } = msg;
        if (action === Action.NewChatMessage) {
          // Append message to last message chunk
          if (userId === myUserId || isInViewport(chatMessagesDivEnd)) {
            setShouldKeepScrollPos(false);
          } else {
            setShouldKeepScrollPos(true);
          }
          setChatMessageChunks((prev) => {
            const last = prev.at(-1);
            if (last) {
              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  total: (last.total ?? 0) + byteLength,
                  messages: [...last.messages, msg],
                },
              ];
            }
            return [{ messages: [msg] }];
          });
          playChime();
        } else if (action === Action.ChangeUsername) {
          if (userId === myUserId) {
            setMyUser((prev) =>
              prev ? { ...prev, username: data.username } : prev,
            );
          }
          setUsers((prev) => ({
            ...prev,
            ...{ [userId]: { ...prev[userId], username: data.username } },
          }));
        } else if (action === Action.RequestUserInfo) {
          setUsers((prev) => ({ ...prev, ...{ [data.userId]: data.user } }));
        } else if (action === Action.GetChatMessages) {
          if (chatMessageChunks.length === 0) {
            // setShouldScrollToEnd(true);
          } else {
            // setShouldKeepScrollPos(true);
          }
          const normalMessages = [];
          for (const chatMessage of data.messages) {
            if (
              !chatMessage.data.editForTimestamp ||
              chatMessage.data.editForTimestamp === ""
            ) {
              normalMessages.push(chatMessage);
            } else {
              editedMessages.push(chatMessage);
            }
          }
          data.messages = normalMessages;
          setChatMessageChunks((prev) => {
            const chunks: ChatMessageChunk[] = [data, ...prev];
            const toDelete: Set<ChatMessage> = new Set([]);
            for (const editedMessage of editedMessages) {
              for (const chunk of chunks) {
                if (
                  chunk.messages[0] &&
                  chunk.messages[0].data.timestamp >
                  editedMessage.data.editForTimestamp
                ) {
                  continue;
                }
                if (
                  chunk.messages.at(-1) &&
                  chunk.messages.at(-1)!.data.timestamp <
                  editedMessage.data.editForTimestamp
                ) {
                  continue;
                }
                const chatMessage = chunk.messages.find(
                  (v) =>
                    v.data.timestamp === editedMessage.data.editForTimestamp,
                );
                if (chatMessage) {
                  chatMessage.data.content = editedMessage.data.content;
                  chatMessage.edited = true;
                  toDelete.add(editedMessage);
                }
              }
            }
            const newEditedMessages = editedMessages.filter(
              (v) => !toDelete.has(v),
            );
            setEditedMessages(newEditedMessages);
            return chunks;
          });
          setLoadedMessages(true);
          setMessagesOffset(data.start);
        } else if (action === Action.UpdateMyUserInfo) {
          // All of this shit just to determine when to play some damn sounds
          const oldPresence = users[userId]?.presence;
          if (
            userId !== data.userId &&
            ringtone &&
            oldPresence !== data.presence &&
            (oldPresence === Presence.InCall || // Someone left the call
              data.presence === Presence.InCall) // Someone joined the call
          ) {
            if (isInCall && oldPresence === Presence.InCall && leaveSound) {
              leaveSound.currentTime = 0;
              leaveSound.play();
            }
            if (isInCall && data.presence === Presence.InCall && joinSound) {
              joinSound.currentTime = 0;
              joinSound.play();
            }

            let numUsersInCall = 0;
            for (const uid in users) {
              if (users[uid].presence === Presence.InCall) {
                numUsersInCall++;
                if (numUsersInCall > 1) {
                  break;
                }
              }
            }
            if (numUsersInCall === 0 && data.presence === Presence.InCall) {
              // Someone started a new call
              ringtone.play();
            } else if (numUsersInCall === 1) {
              // Either the last person in the call left, or a second person joined
              ringtone.pause();
              ringtone.currentTime = 0;
            }
          }

          if (userId === myUserId) {
            setMyUser((prev) => (prev ? { ...prev, ...data } : prev));
          }
          setUsers((prev) => ({ ...prev, ...{ [userId]: data } }));
        } else if (action === Action.GetAllUsers) {
          setUsers(msg.data.users);
        } else if (action === Action.JoinCall) {
          if (isInCall && localStream && peer && data.peerId !== peer.id) {
            // Send userId to peer
            const conn = peer.connect(data.peerId);
            conn.on("open", () => conn.send({ userId: myUserId }));
            // Call peer
            const call = peer.call(data.peerId, localStream);
            call.on("stream", (remoteStream) => {
              setAudioStreams((prev) => ({
                ...prev,
                [call.peer]: remoteStream,
              }));
              addAudio(call.peer, remoteStream);
            });
            setUserPeerIds((prev) => ({ ...prev, [userId]: data.peerId }));
          }
        } else if (action === Action.GetMySettings) {
          setMySettings(data);
        } else if (action === Action.UpdateMySettings) {
          setMySettings(data);
        } else if (action === Action.EditChatMessage) {
          setChatMessageChunks((prev) => {
            const chunks = [...prev];
            for (const chunk of chunks) {
              if (
                chunk.messages[0] &&
                chunk.messages[0].data.timestamp > data.editForTimestamp
              ) {
                continue;
              }
              if (
                chunk.messages.at(-1) &&
                chunk.messages.at(-1)!.data.timestamp < data.editForTimestamp
              ) {
                continue;
              }
              const chatMessage = chunk.messages.find(
                (v) => v.data.timestamp === data.editForTimestamp,
              );
              if (chatMessage) {
                chatMessage.data.content = data.content;
                chatMessage.edited = true;
                chunk.total = (chunk.total ?? 0) + byteLength;
              }
            }
            return chunks;
          });
        }
      }
    },
    [
      chatMessageChunks.length,
      editedMessages,
      isInCall,
      joinSound,
      leaveSound,
      localStream,
      myUserId,
      peer,
      playChime,
      ringtone,
      users,
    ],
  );

  // Register websocket event handler
  useEffect(() => {
    if (!socket) return;
    socket.onopen = () => {
      handleSocketOnOpen();
      setConnected(true);
      setOpened(true);
      setError(undefined);
    };
    socket.onmessage = handleSocketMessage;
    socket.onclose = () => {
      setConnected(false);
      setError("Connection problem");
      setTimeout(() => api.socket().then((ws) => setSocket(ws)), 5000);
    };
  }, [handleSocketMessage, handleSocketOnOpen, socket]);

  const loadUnknownUsers = useCallback(() => {
    if (!connected) return;
    const requested = new Set();
    for (const { userId } of chatMessageChunks.at(-1)?.messages ?? []) {
      if (!requested.has(userId) && !(userId in users)) {
        requested.add(userId);
        send(Action.RequestUserInfo, { userId });
      }
    }
  }, [chatMessageChunks, connected, send, users]);

  // Request user info for unknown userIds upon loading new message chunks
  useEffect(() => {
    loadUnknownUsers();
  }, [loadUnknownUsers, chatMessageChunks.length]);

  // Sync myUser with entry in users dictionary
  useEffect(() => {
    if (!myUser) return;
    setUsers((prev) => ({ ...prev, ...{ [myUserId]: myUser } }));
  }, [myUser, myUserId]);

  const processMessageContent = useCallback(
    (content: string) => {
      content = content.trim();
      if (content) {
        content = mentions.subUsernames(content, users);
      }
      return content;
    },
    [users],
  );

  const sendNewChatMessage = useCallback(
    (content: string) => {
      content = processMessageContent(content);
      if (content) {
        send(Action.NewChatMessage, {
          chatId: "global",
          data: {
            content,
            ...(replyingTo && {
              replyToUserId: replyingTo.userId,
              replyTo: replyingTo.data,
            }),
          },
        });
      }
    },
    [processMessageContent, replyingTo, send],
  );

  const editChatMessage = useCallback(
    (chunk: ChatMessageChunk, message: ChatMessage, content: string) => {
      content = processMessageContent(content);
      if (content) {
        send(Action.EditChatMessage, {
          chatId: "global",
          start: chunk.start,
          total: chunk.total,
          data: { content, editForTimestamp: message.data.timestamp },
        });
      }
    },
    [processMessageContent, send],
  );

  function isInViewport(ref: RefObject<HTMLElement>) {
    if (!ref.current) return false;
    const { top, bottom } = ref.current.getBoundingClientRect();
    return (
      (top >= 0 && top <= window.innerHeight) ||
      (bottom >= 0 && bottom <= window.innerHeight)
    );
  }

  // Load more chat messages when the user scrolls to the top
  const loadMoreMessages = useCallback(() => {
    if (
      isInViewport(chatMessagesSpinnerDiv) &&
      loadedMessages &&
      messagesOffset
    ) {
      setLoadedMessages(false);

      // Save current scroll state before new messages are loaded
      setChatMessagesScrollPos(chatMessagesDiv.current?.scrollTop ?? 0);
      setChatMessagesHeight(chatMessagesDiv.current?.scrollHeight ?? 0);

      send(Action.GetChatMessages, {
        chatId: "global",
        start: Math.max(0, messagesOffset - chunkSize),
        total: Math.min(messagesOffset, chunkSize),
      });
    }
  }, [loadedMessages, messagesOffset, send]);

  if (sessionToken && opened) {
    return (
      <div className="flex w-full">
        <div className="bg-content2 flex flex-col min-w-[270px] max-w-[270px]">
          <ScrollShadow
            hideScrollBar
            size={20}
            className="flex-grow flex flex-col"
          >
            {Object.entries(
              Object.entries(users).reduce(
                // Group users by their presence
                (byPresence: any, [userId, user]) => {
                  let g = "offline";
                  if (user.presence === Presence.InCall) {
                    g = "in call";
                  } else if (
                    user.presence === Presence.Online ||
                    user.presence === Presence.Away
                  ) {
                    g = "online";
                  } else if (!user.changedUsername) {
                    g = "offline (unnamed)";
                  }
                  byPresence[g].push([userId, user]);
                  return byPresence;
                },
                {
                  "in call": [],
                  online: [],
                  offline: [],
                  "offline (unnamed)": [],
                },
              ),
            ).map(([g, group]: [string, any]) => (
              // Header for each group
              <div key={`users_${g}`} className="flex flex-col">
                {group.length > 0 && (
                  <strong className="text-default-500 ml-1">
                    <small>{g}</small>
                  </strong>
                )}
                {group
                  // Sort by username
                  .sort((a: any, b: any) =>
                    a[1].username.localeCompare(b[1].username),
                  )
                  .map(([userId, user]: any) => (
                    <UserElement
                      key={`user_${userId}`}
                      user={user}
                      audio={
                        userPeerIds[userId]
                          ? audios[userPeerIds[userId]]
                          : undefined
                      }
                      isCalling={
                        userId === myUserId &&
                        !(ringtone?.paused ?? true) &&
                        isInCall
                      }
                    ></UserElement>
                  ))}
              </div>
            ))}
          </ScrollShadow>
          {myUser && peer && (
            <div
              className="bg-content1 !bg-cover bg-off-center"
            // style={{ background: getBannerBackground(myUser.bannerUrl) }}
            >
              <div className="flex gap-2 py-1 justify-center">
                <Tooltip disableAnimation closeDelay={0} content="Join Call">
                  <Button
                    isIconOnly
                    size="sm"
                    color="success"
                    variant={
                      !isInCall && !(ringtone?.paused ?? true)
                        ? "solid"
                        : "light"
                    }
                    isDisabled={isInCall}
                    className={clsx(
                      "text-foreground",
                      !isInCall &&
                      !(ringtone?.paused ?? true) &&
                      "bg-green-500 animate-pulse",
                    )}
                    onPress={() => changeCallStatus(true)}
                  >
                    <Call />
                  </Button>
                </Tooltip>
                <Tooltip
                  disableAnimation
                  closeDelay={0}
                  content={
                    !isInCall && !(ringtone?.paused ?? true)
                      ? "Decline Call"
                      : "End Call"
                  }
                >
                  <Button
                    isIconOnly
                    size="sm"
                    color="danger"
                    variant={
                      isInCall || !(ringtone?.paused ?? true)
                        ? "solid"
                        : "light"
                    }
                    isDisabled={!isInCall && (ringtone?.paused ?? true)}
                    className={clsx(
                      "text-foreground",
                      !isInCall &&
                      !(ringtone?.paused ?? true) &&
                      "animate-pulse",
                    )}
                    onPress={() => changeCallStatus(false)}
                  >
                    <CallEnd />
                  </Button>
                </Tooltip>
                <Tooltip
                  disableAnimation
                  closeDelay={0}
                  content={isMuted ? "Unmute" : "Mute"}
                >
                  <Button
                    isIconOnly
                    size="sm"
                    radius="full"
                    color={
                      !isInCall || isMuted || isDeafened ? "default" : "primary"
                    }
                    variant={isInCall ? "solid" : "light"}
                    isDisabled={!isInCall || isDeafened}
                    onPress={() => setIsMuted(!isMuted)}
                  >
                    {isMuted || isDeafened ? <MicOff /> : <Mic />}
                  </Button>
                </Tooltip>
                <Tooltip
                  disableAnimation
                  closeDelay={0}
                  content={isDeafened ? "Undeafen" : "Deafen"}
                >
                  <Button
                    isIconOnly
                    size="sm"
                    radius="full"
                    color={!isInCall || isDeafened ? "default" : "primary"}
                    variant={isInCall ? "solid" : "light"}
                    isDisabled={!isInCall}
                    onPress={() => setIsDeafened(!isDeafened)}
                  >
                    {isDeafened ? <HeadsetOff /> : <Headset />}
                  </Button>
                </Tooltip>
              </div>
            </div>
          )}
          {myUser && (
            <MyUser
              myUser={myUser}
              mySettings={mySettings}
              send={send}
              error={error}
            />
          )}
        </div>
        <main id="chatarea" className="bg-content3 flex flex-col min-w-0 w-full">
          <ScrollShadow
            hideScrollBar
            ref={chatMessagesDiv}
            size={20}
            className="flex-grow flex flex-col w-full items-center"
            onScroll={loadMoreMessages}
          >
            {messagesOffset > 0 && <Spinner ref={chatMessagesSpinnerDiv} />}
            {chatMessageChunks.flatMap((chunk, c) =>
              chunk.messages
                .reduce(
                  (
                    bins: { msg: ChatMessage; showUsername: boolean }[][],
                    msg: ChatMessage,
                  ) => {
                    // Group messages and only show the username for the first message in the group
                    const prevBin = bins.at(-1);
                    if (prevBin) {
                      const prevUserId = prevBin[0].msg.userId;
                      const prevTs = prevBin[0].msg.data.timestamp;
                      // Group messages that are from the same user and sent within a small timeframe
                      if (
                        prevUserId === msg.userId &&
                        moment(msg.data.timestamp).diff(
                          moment(prevTs),
                          "minute",
                        ) <= 2
                      ) {
                        prevBin.push({ msg, showUsername: false });
                        return bins;
                      }
                    }
                    bins.push([{ msg, showUsername: true }]);
                    return bins;
                  },
                  [],
                )
                .flatMap((bin, b) =>
                  bin.map(({ msg, showUsername }, i) => (
                    <ChatMessageElement
                      key={`msg_${c}_${b}_${i}`}
                      icon={users[msg.userId]?.icon ?? ""}
                      username={users[msg.userId]?.username ?? ""}
                      usernameColor={users[msg.userId]?.usernameColor}
                      showUsername={showUsername}
                      msg={msg}
                      users={users}
                      myUserId={myUserId}
                      myUsername={myUser?.username ?? ""}
                      isDeveloper={users[msg.userId]?.isDeveloper}
                      setImageModalSrc={setImageModalSrc}
                      imageOnOpen={imageOnOpen}
                      isOwned={msg.userId === myUserId}
                      editChatMessage={(content) =>
                        editChatMessage(chunk, msg, content)
                      }
                      onReply={() => setReplyingTo(msg)}
                      setShouldScrollToEnd={setShouldScrollToEnd}
                    />
                  )),
                ),
            )}
            <div ref={chatMessagesDivEnd} className="text-sm select-none">
              &nbsp;
            </div>
          </ScrollShadow>
          <div className="flex w-full justify-center">
            <ChatInput
              sendNewChatMessage={sendNewChatMessage}
              textareaRef={chatInputTextarea}
              sessionToken={sessionToken}
              users={users}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
            />
          </div>
        </main>
        <KeybindsModal isOpen={keybindsIsOpen} onClose={keybindsOnClose} />
        <ImageModal
          isOpen={imageIsOpen}
          onClose={imageOnClose}
          imageSrc={imageModalSrc}
        />
      </div>
    );
  } else {
    return (
      <Login
        setSessionToken={setSessionToken}
        setMyUserId={setMyUserId}
        setMyUser={setMyUser}
      />
    );
  }
}
