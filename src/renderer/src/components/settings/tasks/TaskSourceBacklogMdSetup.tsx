import { TaskSourceShowInTasksStep } from './TaskSourceShowInTasksStep'
import { useTranslate } from '@/i18n/use-translate'

export function BacklogMdSetupSteps(props: {
  providerLabel: string
  visible: boolean
  canHide: boolean
  onToggleVisible: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <ol className="divide-y divide-border/50">
      <TaskSourceShowInTasksStep
        index={1}
        providerLabel={props.providerLabel}
        visible={props.visible}
        canHide={props.canHide}
        onToggleVisible={props.onToggleVisible}
        description={t(
          'auto.components.settings.TasksPane.backlogMdShowDescription',
          'Tasks are read from the backlog folder of the selected repository. No sign-in needed.'
        )}
      />
    </ol>
  )
}
