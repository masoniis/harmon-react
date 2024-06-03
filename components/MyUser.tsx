import { Settings } from "@mui/icons-material";
import { Button } from "@nextui-org/button";
import PresenceIcon from "./PresenceIcon";
import { useEffect, useRef, useState } from "react";
import { Input } from "@nextui-org/input";
import { Action, MySettings, User } from "@/types/types";
import { useDisclosure } from "@nextui-org/modal";
import UserSettingsModal from "./UserSettingsModal";
import Username from "./Username";
import { getBannerBackground } from "@/styles/computed";
import { Tooltip } from "@nextui-org/tooltip";
import Status from "./Status";

export default function MyUser({
  myUser,
  mySettings,
  send,
  error,
}: {
  myUser: User;
  mySettings: MySettings | undefined;
  send: (action: Action, data: any) => void;
  error?: string;
}) {
  const {
    isOpen: settingsIsOpen,
    onOpen: settingsOnOpen,
    onClose: settingsOnClose,
  } = useDisclosure();

  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [isEditingStatus, setIsEditingStatus] = useState(false);

  const editUsernameInput = useRef<HTMLInputElement>(null);
  const editStatusInput = useRef<HTMLInputElement>(null);

  // EPIC KEYBINDS 😎
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (e.key === "S") {
        e.preventDefault();
        settingsOnOpen();
      } else if (e.key === "s") {
        e.preventDefault();
        setIsEditingStatus((prev) => !prev);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOnOpen]);

  function editUser(updated: User) {
    send(Action.UpdateMyUserInfo, updated);
  }

  function editStatus() {
    editUser({ ...myUser, status: editStatusInput.current?.value ?? "" });
    setIsEditingStatus(false);
  }

  function editUsername() {
    const username = editUsernameInput.current?.value;
    if (username) {
      send(Action.ChangeUsername, { username });
      setIsEditingUsername(false);
    }
  }

  return (
    <div
      className="flex items-center px-2 py-1 gap-2 bg-content1 !bg-cover !bg-center"
      style={{ background: getBannerBackground(myUser.bannerUrl) }}
    >
      <div className="flex-grow flex flex-col min-w-0">
        {isEditingUsername ? (
          <Input
            ref={editUsernameInput}
            autoFocus
            size="sm"
            variant="faded"
            defaultValue={myUser.username}
            onFocus={() => {
              editUsernameInput.current?.select();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" || e.key === "Enter") {
                e.preventDefault();
                editUsername();
              }
            }}
            onBlur={editUsername}
          ></Input>
        ) : (
          <p
            className="text-ellipsis overflow-hidden hover:backdrop-blur-md hover:backdrop-brightness-50 hover:cursor-text rounded"
            onClick={() => setIsEditingUsername(true)}
          >
            <Username color={myUser.usernameColor}>{myUser.username}</Username>
          </p>
        )}
        <div className="flex gap-2">
          <PresenceIcon presence={myUser.presence} error={error} />
          {isEditingStatus ? (
            <Input
              ref={editStatusInput}
              autoFocus
              size="sm"
              variant="faded"
              defaultValue={myUser.status}
              onFocus={() => {
                editStatusInput.current?.select();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter") {
                  e.preventDefault();
                  editStatus();
                }
              }}
              onBlur={editStatus}
            ></Input>
          ) : (
            <div
              className="hover:backdrop-blur-md hover:backdrop-brightness-50 hover:cursor-text text-ellipsis overflow-hidden flex-grow rounded"
              onClick={() => setIsEditingStatus(true)}
            >
              <Status>{myUser.status}</Status>
            </div>
          )}
        </div>
      </div>
      <Tooltip disableAnimation closeDelay={0} content="Settings">
        <Button isIconOnly size="sm" variant="light" onPress={settingsOnOpen}>
          <Settings />
        </Button>
      </Tooltip>
      <UserSettingsModal
        // Cursed way to get this shit to actually update the myUser prop
        key={JSON.stringify(myUser) + JSON.stringify(mySettings)}
        myUser={myUser}
        editUser={editUser}
        isOpen={settingsIsOpen}
        onClose={settingsOnClose}
        mySettings={mySettings}
        send={send}
      />
    </div>
  );
}
