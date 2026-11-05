import type { KnowledgeMapEntry } from "@t3tools/contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import {
  useSettingsEnvironmentMenu,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";
import { knowledgeMapTargets } from "./knowledgeMapSettings";

export function SettingsKnowledgeMapRouteScreen() {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const targets = knowledgeMapTargets(selectedTargets);
  const environmentMenu = useSettingsEnvironmentMenu();
  const insets = useSafeAreaInsets();

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="What you know" menus={[environmentMenu]}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-5 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          {targets.length > 0 ? (
            targets.map((target) => (
              <KnowledgeMapEnvironment key={target.environmentId} target={target} />
            ))
          ) : (
            <Text className="px-2 text-base text-foreground-muted">
              No environment here keeps a knowledge map. Change the filter above.
            </Text>
          )}
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

function KnowledgeMapEnvironment(props: {
  readonly target: ReturnType<typeof knowledgeMapTargets>[number];
}) {
  const selectDetail = useSelectWorkspaceDetail();
  const query = useEnvironmentQuery(
    serverEnvironment.knowledgeMap({ environmentId: props.target.environmentId, input: {} }),
  );

  return (
    <SettingsSection title={props.target.label}>
      {query.isPending && query.data === null ? (
        <View className="items-center gap-3 px-6 py-8">
          <AppActivityIndicator />
          <Text className="text-center text-sm text-foreground-muted">Loading…</Text>
        </View>
      ) : query.error !== null ? (
        <View className="gap-1 px-2 py-3">
          <Text className="text-base text-foreground">Couldn&apos;t load</Text>
          <Text className="text-sm text-foreground-muted">{query.error}</Text>
        </View>
      ) : query.data !== null && query.data.length > 0 ? (
        query.data.map((entry) => (
          <KnowledgeMapEntryRow
            key={entry.topic}
            entry={entry}
            onPress={() =>
              selectDetail({
                name: "Thread",
                params: {
                  environmentId: props.target.environmentId,
                  threadId: entry.threadId,
                },
              })
            }
          />
        ))
      ) : (
        <View className="px-2 py-3">
          <Text className="text-sm text-foreground-muted">
            Nothing yet. In any lesson, say &quot;mark &lt;topic&gt; done&quot; and explain it back.
          </Text>
        </View>
      )}
    </SettingsSection>
  );
}

function KnowledgeMapEntryRow(props: {
  readonly entry: KnowledgeMapEntry;
  readonly onPress: () => void;
}) {
  return (
    <ListActionRow
      icon="brain"
      label={props.entry.topic}
      description={`${props.entry.explanation} · ${new Date(props.entry.doneAt).toLocaleDateString()}`}
      onPress={props.onPress}
    />
  );
}
